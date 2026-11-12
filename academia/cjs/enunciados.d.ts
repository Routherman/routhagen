export interface Enunciado {
    /** 1, 2, 3… Es la clave en academia_practicas.ejercicio: no reusar números. */
    numero: number;
    titulo: string;
    /** Qué entrena. Va arriba de todo: se entiende mejor sabiendo para qué es. */
    habilidad: string;
    /** El pedido, en las palabras en que lo diría un cliente. */
    pedido: string;
    /** Lo que el trabajo tiene que incluir. Es la lista con la que se corrige. */
    incluye: string[];
    /** Qué hay que explicar por escrito. Es la mitad del ejercicio. */
    explicar: string;
    /** Si la entrega exige un trabajo enganchado (trabajoRef). */
    requiereTrabajo: boolean;
    /**
     * Link a la herramienta del sistema con los datos del caso precargados (por
     * query string), para que no arranquen copiando a mano. Lo arma el front.
     * Ejemplo: '/herramienta/nueva?practica=1&ejercicio=1&dato=valor'
     */
    linkHerramienta?: string;
}
export declare const ENUNCIADOS_EJEMPLO: Enunciado[];
