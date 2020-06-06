const fs = require('fs-extra');
const _ = require('lodash');
const xml2js = require('xml2js');

function fileExists(path) {
    try {
        return fs.statSync(path).isFile();
    } catch (e) {
        return false;
    }
}

module.exports = function (context) {
    return getTargetLang(context).then(function (languages) {
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

        return Promise.all(promisesToRun);
    });
};

function getTranslationPath (config, name) {
    const value = config.match(new RegExp('name="' + name + '" value="(.*?)"', "i"))

    if(value && value[1]) {
        return value[1];

    } else {
        return null;
    }
}

function getDefaultPath(context){
    const configNodes = context.opts.plugin.pluginInfo._et._root._children;
    let defaultTranslationPath = '';

    for (const node in configNodes) {
        if (configNodes[node].attrib.name == 'TRANSLATION_PATH') {
            defaultTranslationPath = configNodes[node].attrib.default;
        }
    }
    return defaultTranslationPath;
}

function getTargetLang(context) {
    const targetLangArr = [];

    const path = require('path');
    const glob = require('glob');
    let providedTranslationPathPattern;
    let providedTranslationPathRegex;
    const config = fs.readFileSync("config.xml").toString();
    let PATH = getTranslationPath(config, "TRANSLATION_PATH");

    if(PATH == null){
        PATH = getDefaultPath(context);
        providedTranslationPathPattern = PATH + "*.json";
        providedTranslationPathRegex = new RegExp((PATH + "(.*).json"));
    }
    if(PATH != null){
        if(/^\s*$/.test(PATH)){
            providedTranslationPathPattern = getDefaultPath(context);
            providedTranslationPathPattern = PATH + "*.json";
            providedTranslationPathRegex = new RegExp((PATH + "(.*).json"));
        }
        else {
            providedTranslationPathPattern = PATH + "*.json";
            providedTranslationPathRegex = new RegExp((PATH + "(.*).json"));
        }
    }
    return new Promise(function(resolve, reject) {
      glob(providedTranslationPathPattern, function(error, langFiles) {
        if (error) {
          reject(error);
        }
        langFiles.forEach(function(langFile) {
          const matches = langFile.match(providedTranslationPathRegex);
          if (matches) {
            targetLangArr.push({
              lang: matches[1],
              path: path.join(context.opts.projectRoot, langFile)
            });
          }
        });
        resolve(targetLangArr);
      })
    });
}

function getLocalizationDir(context, lang) {
    const path = require('path');

    let langDir;
    if (lang === "en") {
      langDir = path.normalize(path.join(getResPath(context), 'values'));
    } else {
      langDir = path.normalize(path.join(getResPath(context), 'values-b+' + lang.replace('_', '+')));
    }
    return langDir;
}

function getLocalStringXmlPath(context, lang) {
    const path = require('path');

    let filePath;
    if (lang === "en") {
      filePath = path.normalize(path.join(getResPath(context), 'values/strings.xml'));
    } else {
      filePath = path.normalize(path.join(getResPath(context), 'values-b+' + lang.replace('_', '+') + '/', 'strings.xml'));
    }
    return filePath;
}

function getResPath(context) {
    const path = require('path');
    return path.join(context.opts.projectRoot, 'platforms/android/app/src/main/res');
}

// process the modified xml and put write to file
function processResult(context, lang, langJson, stringXmlJson) {
    const mapObj = {};
    // create a map to the actual string
    _.forEach(stringXmlJson.resources.string, function (val) {
        if (_.has(val, "$") && _.has(val["$"], "name")) {
            mapObj[val["$"].name] = val;
        }
    });

    const langJsonToProcess = _.assignIn(langJson.config_android, langJson.app, langJson.app_android);

    //now iterate through langJsonToProcess
    _.forEach(langJsonToProcess, function (val, key) {
        // positional string format is in Mac OS X format.  change to android format
        val = val.replace(/\$@/gi, "$s");
        val = val.replace(/\'/gi, "\\'");

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
    const langDir = getLocalizationDir(context, lang);
    const filePath = getLocalStringXmlPath(context, lang);

    return new Promise(function(resolve, reject) {
      fs.ensureDir(langDir, function (error) {
        if (error) {
          reject(error);
        }

        fs.writeFile(filePath, buildXML(stringXmlJson), {encoding: 'utf8'}, function (error) {
            if (error) {
              reject(error);
            }

            console.log('Saved:' + filePath);
            resolve();
        });
      });
    })

    function buildXML(obj) {
        const builder = new xml2js.Builder();
        builder.options.renderOpts.indent = '\t';

        const x = builder.buildObject(obj);
        return x.toString();
    }
}
