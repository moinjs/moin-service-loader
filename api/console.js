module.exports = function (moin) {
    moin.on("loadService", (handler)=> {
        let logger = moin.getLogger("service:" + handler.getService().getName());
        handler.registerGlobal("console", {
            log(...args){
                logger.debug(...args);
            },
            error(...args){
                logger.error(...args);
            },
            warn(...args){
                logger.warn(...args);
            },
            info(...args){
                logger.info(...args);
            }
        });
        handler.registerErrorHandler(function (e) {
            logger.error("unhandled error in module", e);
        });
        handler.addApi("logger", logger);
    });
};