// Setup de pruebas: se carga con `node --import ./test/setup.js` ANTES de
// importar cualquier módulo de la aplicación. Fija el entorno en un estado
// determinista para que la suite no dependa de variables externas:
//  - LOGIN_FAIL_DELAY_MS=0: sin pausa (Sesion.js lee este valor al importarse).
//    Se fija siempre (no `??=`) para que un valor alto en el entorno no haga
//    lentas o dependientes del entorno a las pruebas.
//  - DATABASE_URL de relleno: config/database.js lanza si falta la variable;
//    apunta a un puerto cerrado a propósito. El guardián de test/helpers.js
//    evita que alguna prueba llegue a usarlo.

process.env.LOGIN_FAIL_DELAY_MS = "0";
process.env.DATABASE_URL ??= "postgres://u:p@127.0.0.1:1/x";
