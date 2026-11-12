"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adaptarRedis = exports.normalizarRefVideo = exports.ENUNCIADOS_EJEMPLO = exports.trabajoDePracticaBorrado = exports.academiaRouter = void 0;
// Punto de entrada del paquete del backend.
var router_1 = require("./router");
Object.defineProperty(exports, "academiaRouter", { enumerable: true, get: function () { return router_1.academiaRouter; } });
Object.defineProperty(exports, "trabajoDePracticaBorrado", { enumerable: true, get: function () { return router_1.trabajoDePracticaBorrado; } });
var enunciados_1 = require("./enunciados");
Object.defineProperty(exports, "ENUNCIADOS_EJEMPLO", { enumerable: true, get: function () { return enunciados_1.ENUNCIADOS_EJEMPLO; } });
var video_1 = require("./logica/video");
Object.defineProperty(exports, "normalizarRefVideo", { enumerable: true, get: function () { return video_1.normalizarRefVideo; } });
var redis_1 = require("./redis");
Object.defineProperty(exports, "adaptarRedis", { enumerable: true, get: function () { return redis_1.adaptarRedis; } });
