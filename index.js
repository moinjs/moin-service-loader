let fs = require("fs");
let path = require("path");
let newID = require("hat").rack();
const vm = require('vm');
const Module = require("module").Module;

let template = fs
    .readFileSync(path.join(__dirname, "template.js"))
    .toString()
    .split("//CODE");

function getTempFolder(base, subfolder = null) {
    function createFolder(folder) {
        return new Promise((resolve, reject)=> {
            fs.stat(folder, function (err, stat) {
                if (err) {
                    fs.mkdir(folder, function (err) {
                        if (err) {
                            reject();
                        } else {
                            resolve(folder);
                        }
                    });
                } else {
                    resolve(folder);
                }
            });
        });
    }

    return createFolder(base).then((folder)=> {
        if (subfolder == null) return folder;
        return createFolder(path.join(folder, subfolder));
    });
}

module.exports = function (moin) {
    let log = moin.getLogger("service-loader");

    require("./api/console")(moin, log);
    require("./api/timer")(moin, log);

    let _cache = {};

    moin.on("exit", ()=> {
        return moin.unloadAllServices();
    });

    moin.registerMethod("unloadAllServices", function () {
        log.info(`Unloading all Services`);
        return Promise.all(Object.keys(_cache).map(id=> {
            return moin.unloadService(id);
        }));
    });
    moin.registerMethod("unloadService", function (id) {
        _cache[id].unloadHandler.forEach(fnc=> {
            try {
                fnc();
            } catch (e) {
                _cache[id].api.console.error("error in unload handler:", e);
            }
        });

        return moin.emit("unloadService", id)
            .then(()=> {
                log.info(`Service [${_cache[id].name}] unloaded`);
                return new Promise((resolve)=> {
                    fs.unlink(_cache[id].fileName, resolve);
                })
            }, function (e) {
                log.error("error", e)
            }).then(()=> {
                delete _cache[id];
            }).catch(function (e) {
                log.error("error", e)
            });
    });

    moin.registerMethod("getTempFolder", (subfolder = null)=>getTempFolder(moin.joinPath(".moin"), subfolder));


    let modulePath = fs.realpathSync(moin.joinPath("node_modules"));

    moin.registerMethod("loadService", function (servicePath) {

        return new Promise((resolve, reject)=> {
            let serviceOk = true;


            let loaded = null;
            if (this.getLastValue() != undefined) {
                loaded = this.getLastValue();
            } else {
                if (typeof servicePath == "string") {
                    if (!path.isAbsolute(servicePath))servicePath = moin.joinPath(servicePath);
                    loaded = moin.load(servicePath).then(service=> {
                        if (service == null)serviceOk = false;
                        return service;
                    });
                } else {
                    loaded = Promise.resolve(servicePath);
                    servicePath = servicePath.getPath();
                }
            }

            if (!serviceOk) {
                return reject("invalid service");
            }

            loaded.then((service)=> {
                let ok = true;
                return moin.emit("beforeServiceLoad", {
                    service, cancel(){
                        ok = false;
                    }
                }).then((res)=> {
                    return ok ? service : null;
                });
            }).then(function (service) {
                    if (service == null)return reject();
                    return new Promise((resolve, reject)=> {
                        fs.realpath(servicePath, function (err, realpath) {
                            if (err) {
                                reject("cannot get real path of service");
                            } else {
                                let base = null;
                                //check if service path is in node_modules folder
                                if (realpath.indexOf(modulePath) == -1) {
                                    base = moin.joinPath(".moin");
                                } else {
                                    base = path.join(servicePath, ".moin");
                                }
                                resolve({
                                    service,
                                    getTemp(subfolder = null){
                                        return getTempFolder(base, subfolder);
                                    }
                                });
                            }
                        });
                    })
                })
                .then(function ({service,getTemp}) {
                    let id = newID();
                    log.info("Loading Service", service.getName(), " from path ", servicePath);
                    let errorHandler = [];

                    let serviceApi = {
                        moin: {
                            registerUnloadHandler(handler){
                                _cache[id].unloadHandler.push(handler);
                            }
                        },
                        __servicename: service.getName(),
                        __errorHandler(error){
                            try {
                                errorHandler.forEach((fnc)=>fnc(error));
                            } catch (e) {
                                logger.error("error in service error Handler", e);
                            }
                        }
                    };
                    let handler = {
                        getTemp,
                        getId(){
                            return id;
                        },
                        getService(){
                            return service;
                        },
                        registerGlobal(name, data) {
                            if (serviceApi.hasOwnProperty(name))log.warn("possible error detected: double definition of service global [" + name + "]");
                            serviceApi[name] = data;
                        },
                        getApi(){
                            return serviceApi.moin;
                        },
                        addApi(name, data) {
                            if (serviceApi.moin.hasOwnProperty(name))log.warn("possible error detected: double definition of service global [" + name + "]");
                            serviceApi.moin[name] = data;
                        },
                        registerErrorHandler(callback){
                            errorHandler.push(callback);
                        }
                    };

                    moin.emit("loadService", handler)
                        .then(function () {
                            return new Promise((resolve, reject)=> {
                                fs.readFile(path.join(servicePath, "index.js"), function (err, data) {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(data.toString());
                                    }
                                })
                            });
                        })
                        .then(function (code) {
                            return template[0] + code + template[1];
                        })
                        .then(function (code) {
                            let modPath = path.join(servicePath, "index.js");
                            code = `module.exports=function({${Object.keys(serviceApi).join(",")}}){${code}};`;
                            return getTemp("service-cache")
                                .then((tempPath)=> {
                                    return new Promise((resolve, reject)=> {
                                        let fileName = path.join(tempPath, id + ".js");
                                        fs.writeFile(fileName, code, function (err) {
                                            if (err) {
                                                reject("Could not write to tempfile:", fileName);
                                            } else {
                                                resolve(fileName);
                                            }
                                        });
                                    });
                                });
                        }).then(function (fileName) {
                            let loadedService = require(fileName);
                            _cache[id] = {
                                api: serviceApi,
                                name: service.getName(),
                                unloadHandler: [],
                                fileName
                            };
                            loadedService(serviceApi);
                            resolve(id);
                        })
                        .catch(function (e) {
                            log.error("parsing error in service file", path.join(servicePath, "index.js"), e);
                        });
                })
                .catch(function (e) {
                    if (typeof e == "string") {
                        log.error("Error while loading service", e);
                    } else {
                        log.log(e.level, e.message);
                    }
                    reject();
                });
        });
    });
};
