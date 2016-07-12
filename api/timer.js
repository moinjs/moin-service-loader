module.exports = function (moin) {

    let services = {};

    moin.on("unloadService", (id, service)=> {
        if (services.hasOwnProperty(id)) {
            for (key in services[id]) {
                if (!services[id].hasOwnProperty(key))continue;
                let method = "clear" + key.charAt(0).toUpperCase() + key.slice(1);
                for (let timer of services[id][key]) {
                    global[method](timer);
                }
            }
        }
    });
    moin.on("loadService", (handler)=> {
        let id = handler.getId();
        services[id] = {
            "interval": new Set(),
            "timeout": new Set(),
            "immediate": new Set()
        };

        handler.registerGlobal("setInterval", function (fnc, interval) {
            let timer = setInterval(function () {
                try {
                    fnc();
                } catch (e) {
                    handler.getApi().logger.error("Error in setInterval. clearing the handler");
                    handler.getApi().logger.error(e);
                    services[id].interval.delete(timer);
                    clearInterval(timer);
                }
            }, interval);
            services[id].interval.add(timer);
            return timer;
        });
        handler.registerGlobal("clearInterval", function (timer) {
            if (services[id].interval.has(timer))services[id].interval.delete(timer);
            clearInterval(timer);
        });
        handler.registerGlobal("setTimeout", function (fnc, interval) {
            let timer = setTimeout(function () {
                if (services[id].timeout.has(timer))services[id].timeout.delete(timer);
                try {
                    fnc();
                } catch (e) {
                    handler.getApi().logger.error("Error in setTimeout.");
                    handler.getApi().logger.error(e);
                }
            }, interval);
            services[id].timeout.add(timer);
            return timer;
        });
        handler.registerGlobal("clearTimeout", function (timer) {
            if (services[id].timeout.has(timer))services[id].timeout.delete(timer);
            clearTimeout(timer);
        });
        handler.registerGlobal("setImmediate", function (fnc, interval) {
            let timer = setTimeout(function () {
                if (services[id].immediate.has(timer))services[id].immediate.delete(timer);
                try {
                    fnc();
                } catch (e) {
                    handler.getApi().logger.error("Error in setImmediate.");
                    handler.getApi().logger.error(e);
                }
            }, interval);
            services[id].immediate.add(timer);
            return timer;
        });
        handler.registerGlobal("clearImmediate", function (timer) {
            if (services[id].immediate.has(timer))services[id].immediate.delete(timer);
            clearImmediate(timer);
        });

    });
};