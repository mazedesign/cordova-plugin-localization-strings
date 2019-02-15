const fs = require('fs-extra');
const _ = require('lodash');
xml2js = require('xml2js');

function fileExists(path) {
    try {
        return fs.statSync(path).isFile();
    } catch (e) {
        return false;
    }
}

module.exports = function (context) {
    const q = context.requireCordovaModule('q');
    const deferred = q.defer();

    getTargetLang(context).then(function (languages) {
        const promisesToRun = [];

        languages.forEach(function (lang) {
            //read the json file
            const langJson = require(lang.path);

            // check the locales to write to
            const localeLangs = [];
            if (_.has(langJson, "locale") && _.has(langJson.locale, "android")) {
                //iterate the locales to to be iterated.
                _.forEach(langJson.locale.android, function (aLocale) {
                    localeLangs.push(aLocale);
                });
            } else {
                // use the default lang from the filename, for example "en" in en.json
                localeLangs.push(lang.lang);
            }

            _.forEach(localeLangs, function (localeLang) {
                const stringXmlFilePath = getLocalStringXmlPath(context, localeLang);
                const parser = new xml2js.Parser();

                let stringXmlJson;
                if (!fileExists(stringXmlFilePath)) {
                    stringXmlJson = {
                        "resources": {
                            "string": []
                        }
                    };
                    promisesToRun.push(processResult(context, localeLang, langJson, stringXmlJson));
                } else {
                    //lets read from strings.xml into json
                    fs.readFile(stringXmlFilePath, {encoding: 'utf8'}, function (err, data) {
                        if (err) {
                            throw err;
                        }

                        parser.parseString(data, function (err, result) {
                            if (err) {
                                throw err;
                            }

                            stringXmlJson = result;

                            // initialize xmlJson to have strings
                            if (!_.has(stringXmlJson, "resources") || !_.has(stringXmlJson.resources, "string")) {
                                stringXmlJson.resources = {
                                    "string": []
                                };
                            }

                            promisesToRun.push(processResult(context, localeLang, langJson, stringXmlJson));
                        });
                    });
                }
            });
        });

        return q.all(promisesToRun).then(function () {
            deferred.resolve();
        });
    }).catch(function (err) {
        deferred.reject(err);
    });

    return deferred.promise;
};

function getTargetLang(context) {
    const targetLangArr = [];
    const deferred = context.requireCordovaModule('q').defer();
    const path = context.requireCordovaModule('path');
    const glob = context.requireCordovaModule('glob');

    glob("../res/lang/*/translations.json", function (err, langFiles) {
        if (err) {
            deferred.reject(err);
        } else {
            langFiles.forEach(function (langFile) {
                console.warn('langFile: ' + langFile)
                const matches = langFile.match(/\/res\/lang\/(.*)\/translations.json/);
                if (matches) {
                    const langString = matches[1].split('_')[0]
                    console.warn(langString)
                    targetLangArr.push({
                        lang: langString,
                        path: path.join(context.opts.projectRoot, langFile)
                    });
                }
            });
            deferred.resolve(targetLangArr);
        }
    });

    console.warn(
        'targetLangArr: ' + targetLangArr,
    )
    return deferred.promise;
}

function getLocalizationDir(context, lang) {
    const path = context.requireCordovaModule('path');

    let langDir;
    switch (lang) {
        case "en":
            langDir = path.normalize(path.join(getResPath(context), 'values'));
            break;
        default:
            langDir = path.normalize(path.join(getResPath(context), 'values-' + lang));
            break;
    }
    return langDir;
}

function getLocalStringXmlPath(context, lang) {
    const path = context.requireCordovaModule('path');

    let filePath;
    switch (lang) {
        case "en":
            filePath = path.normalize(path.join(getResPath(context), 'values/strings.xml'));
            break;
        default:
            filePath = path.normalize(path.join(getResPath(context), 'values-' + lang + '/', 'strings.xml'));
            break;
    }
    return filePath;
}

function getResPath(context) {
    const path = context.requireCordovaModule('path');
    const locations = context.requireCordovaModule('cordova-lib/src/platforms/platforms').getPlatformApi('android').locations;

    if (locations && locations.res) {
        return locations.res;
    }

    return path.join(context.opts.projectRoot, 'platforms/android/res');
}

// process the modified xml and put write to file
function processResult(context, lang, langJson, stringXmlJson) {
    const path = context.requireCordovaModule('path');
    const q = context.requireCordovaModule('q');
    const deferred = q.defer();

    const mapObj = {};
    // create a map to the actual string
    _.forEach(stringXmlJson.resources.string, function (val) {
        console.warn('val0: ' + JSON.stringify(val, null, 2))
        if (_.has(val, "$") && _.has(val["$"], "name")) {
            mapObj[val["$"].name] = val;
        }
    });

    console.warn('langJson: ' + JSON.stringify(langJson, null, 2))

    const langJsonToProcess = _.assignIn(langJson.config_android, langJson.app);

    //now iterate through langJsonToProcess
    _.forEach(langJsonToProcess, function (val, key) {
        console.warn('val1: ' + val)
        // positional string format is in Mac OS X format.  change to android format
        val = val.replace(/\$@/gi, "$s");

        if (_.has(mapObj, key)) {
            // mapObj contains key. replace key
            mapObj[key]["_"] = val;
        } else {
            // add by inserting
            stringXmlJson.resources.string.push({
                _: val,
                '$': {name: key}
            });
        }
    });

    //save to disk
    // const langDir = getLocalizationDir(context, lang);
    // const filePath = getLocalStringXmlPath(context, lang);
    //
    // fs.ensureDir(langDir, function (err) {
    //     if (err) {
    //         throw err;
    //     }
    //
    //     fs.writeFile(filePath, buildXML(stringXmlJson), {encoding: 'utf8'}, function (err) {
    //         if (err) throw err;
    //         console.warn('Saved:' + filePath);
    //         return deferred.resolve();
    //     });
    // });
    //
    // function buildXML(obj) {
    //     const builder = new xml2js.Builder();
    //     builder.options.renderOpts.indent = '\t';
    //
    //     const x = builder.buildObject(obj);
    //     return x.toString();
    // }

    return deferred.promise;
}
