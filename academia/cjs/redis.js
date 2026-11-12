"use strict";
// ============================================================================
// Redis, opcional.
//
// Se usa para dos cosas que no son la fuente de verdad:
//   · Frenar ráfagas de latidos ANTES de tocar MySQL (un cliente normal manda
//     3 por minuto; más de 12 en un minuto por sesión es un script).
//   · Cachear el catálogo publicado 60 s, que es lo que se lee en cada visita.
//
// El tiempo mirado NO se acumula en Redis para bajarlo después: cada latido
// es un upsert de una fila, barato para MySQL, y acumular afuera significa
// perder minutos reales si Redis se reinicia y duplicar la lógica de topes.
//
// Si Redis no está o falla, todo sigue andando solo con MySQL: cada llamada
// atrapa su error y se comporta como si no hubiera Redis.
//
// Acepta ioredis o node-redis (v4+) sin depender de ninguno: se habla con
// comandos crudos.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.adaptarRedis = adaptarRedis;
exports.almacenSeguro = almacenSeguro;
/** Envuelve un cliente de ioredis o de node-redis. */
function adaptarRedis(cliente) {
    if (!cliente || typeof cliente !== 'object')
        return null;
    let crudo;
    // ioredis primero: también tiene `sendCommand`, pero con otra firma.
    if (typeof cliente.call === 'function') {
        const c = cliente;
        crudo = (args) => c.call(...args);
    }
    else if (typeof cliente.sendCommand === 'function') {
        const c = cliente;
        crudo = (args) => c.sendCommand(args);
    }
    else {
        return null;
    }
    return {
        async get(clave) {
            const v = await crudo(['GET', clave]);
            return v == null ? null : String(v);
        },
        async setConVencimiento(clave, valor, segundos) {
            await crudo(['SET', clave, valor, 'EX', String(segundos)]);
        },
        async incrConVencimiento(clave, segundos) {
            const n = Number(await crudo(['INCR', clave]));
            // Solo al crear la clave: si no, la ventana se correría con cada latido.
            if (n === 1)
                await crudo(['EXPIRE', clave, String(segundos)]);
            return n;
        },
        async del(clave) {
            await crudo(['DEL', clave]);
        },
    };
}
/** Un almacén que nunca falla hacia afuera. */
function almacenSeguro(a, alFallar) {
    const intentar = async (fn, siFalla) => {
        if (!a)
            return siFalla;
        try {
            return await fn();
        }
        catch (e) {
            alFallar?.(e);
            return siFalla;
        }
    };
    return {
        disponible: !!a,
        get: (k) => intentar(() => a.get(k), null),
        set: (k, v, s) => intentar(() => a.setConVencimiento(k, v, s), undefined),
        /** null = no se pudo contar (sin Redis): el llamador decide sin el límite. */
        incr: (k, s) => intentar(() => a.incrConVencimiento(k, s), null),
        del: (k) => intentar(() => a.del(k), undefined),
    };
}
