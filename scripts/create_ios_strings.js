const fs = require('fs-extra');
const _ = require('lodash');
const iconv = require('iconv-lite');
const xmldom = require('xmldom');
const path = require('path');

let iosProjFolder;
let iosPbxProjPath;

const getValue = function (configDoc, name) {
  name = configDoc.getElementsByTagName(name)[0];
  return name.textContent
}

function jsonToDotStrings(jsonObj) {
  let returnString = "";
  _.forEach(jsonObj, function (val, key) {
    returnString += '"' + key + '" = "' + val + '";\n';
  });
  return returnString;
}

function initIosDir() {
  if (!iosProjFolder || !iosPbxProjPath) {
    const config = fs.readFileSync("config.xml").toString();
    const configDoc = (new xmldom.DOMParser()).parseFromString(config, 'application/xml');
    const name = getValue(configDoc, "name");

    iosProjFolder = "platforms/ios/" + name;
    iosPbxProjPath = "platforms/ios/" + name + ".xcodeproj/project.pbxproj";
  }
}

function getTargetIosDir() {
  initIosDir();
  return iosProjFolder;
}

function getXcodePbxProjPath() {
  initIosDir();
  return iosPbxProjPath;
}

function writeStringFile(plistStringJsonObj, lang, fileName) {
  const lProjPath = getTargetIosDir() + "/Resources/" + lang + ".lproj";
  fs.ensureDir(lProjPath, function (err) {
    if (!err) {
      const stringToWrite = jsonToDotStrings(plistStringJsonObj);
      const buffer = iconv.encode(stringToWrite, 'utf8');

      fs.open(lProjPath + "/" + fileName, 'w', function (err, fd) {
        if (err) throw err;
        fs.writeFileSync(fd, buffer);
      });
    }
  });
}

function writeLocalisationFieldsToXcodeProj(filePaths, groupname, proj) {
  const fileRefSection = proj.pbxFileReferenceSection();
  const fileRefValues = _.values(fileRefSection);

  if (filePaths.length > 0) {

    // const groupKey;
    let groupKey = proj.findPBXVariantGroupKey({name: groupname});
    if (!groupKey) {
      // findPBXVariantGroupKey with name InfoPlist.strings not found.  creating new group
      const localizableStringVarGroup = proj.addLocalizationVariantGroup(groupname);
      groupKey = localizableStringVarGroup.fileRef;
    }

    filePaths.forEach(function (path) {
      const results = _.find(fileRefValues, function (o) {
        return (_.isObject(o) && _.has(o, "path") && o.path.replace(/['"]+/g, '') == path)
      });
      if (_.isUndefined(results)) {
        //not found in pbxFileReference yet
        proj.addResourceFile("Resources/" + path, {constiantGroup: true}, groupKey);
      }
    });
  }
}

module.exports = function (context) {
  const xcode = require('xcode');

  const localizableStringsPaths = [];
  const infoPlistPaths = [];

  return getTargetLang(context)
    .then(function (languages) {

      languages.forEach(function (lang) {

        //read the json file
        const langJson = require(lang.path);

        // check the locales to write to
        const localeLangs = [];
        if (_.has(langJson, "locale") && _.has(langJson.locale, "ios")) {
          //iterate the locales to to be iterated.
          _.forEach(langJson.locale.ios, function (aLocale) {
            localeLangs.push(aLocale);
          });
        } else {
          // use the default lang from the filename, for example "en" in en.json
          localeLangs.push(lang.lang);
        }

        _.forEach(localeLangs, function (localeLang) {
          if (_.has(langJson, "config.config_ios")) {
            //do processing for appname into plist
            const plistString = langJson.config.config_ios;
            if (!_.isEmpty(plistString)) {
              localeLang = localeLang.replace('/translations', '');
              console.warn('--------------', localeLang);
              writeStringFile(plistString, localeLang, "InfoPlist.strings");
              infoPlistPaths.push(localeLang + ".lproj/" + "InfoPlist.strings");
              console.log(localeLang + ".lproj/" + "InfoPlist.strings");
            }
          }

          //remove APP_NAME and write to Localizable.strings
          if (_.has(langJson, "appName")) {
            //do processing for appname into plist
            const localizableStringsJson = langJson.appName;
            //ios specific strings
            if (_.has(langJson, "appName_ios")) {
              Object.assign(localizableStringsJson, langJson.app_ios);
            }

            if (!_.isEmpty(localizableStringsJson)) {
              writeStringFile(localizableStringsJson, localeLang, "Localizable.strings");
              localizableStringsPaths.push(localeLang + ".lproj/" + "Localizable.strings");
            }
          }
        });

      });

      const proj = xcode.project(getXcodePbxProjPath());

      return new Promise(function (resolve, reject) {
        proj.parse(function (error) {
          if (error) {
            reject(error);
          }

          writeLocalisationFieldsToXcodeProj(localizableStringsPaths, 'Localizable.strings', proj);
          writeLocalisationFieldsToXcodeProj(infoPlistPaths, 'InfoPlist.strings', proj);

          fs.writeFileSync(getXcodePbxProjPath(), proj.writeSync());
          console.log('new pbx project written with localization groups');
          const platformPath = path.join(context.opts.projectRoot, "platforms", "ios");
          const projectFileApi = require(path.join(platformPath, "/cordova/lib/projectFile.js"));
          projectFileApi.purgeProjectFileCache(platformPath);
          console.log(platformPath + ' purged from project cache');
          resolve();
        });
      });
    });
};


function getTranslationPath(config, name) {
  const value = config.match(new RegExp('name="' + name + '" value="(.*?)"', "i"))

  if (value && value[1]) {
    return value[1];

  } else {
    return null;
  }
}

function getDefaultPath(context) {
  const configNodes = context.opts.plugin.pluginInfo._et._root._children;
  let defaultTranslationPath = '';

  for (const node in configNodes) {
    if (configNodes[node].attrib.name === 'TRANSLATION_PATH') {
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

  if (PATH == null) {
    PATH = getDefaultPath(context);
    providedTranslationPathPattern = PATH + "*.json";
    providedTranslationPathRegex = new RegExp((PATH + "(.*).json"));
  }
  if (PATH != null) {
    if (/^\s*$/.test(PATH)) {
      providedTranslationPathPattern = getDefaultPath(context);
      providedTranslationPathPattern = PATH + "*.json";
      providedTranslationPathRegex = new RegExp((PATH + "(.*).json"));
    } else {
      providedTranslationPathPattern = PATH + "*.json";
      providedTranslationPathRegex = new RegExp((PATH + "(.*).json"));
    }
  }

  return new Promise(function (resolve, reject) {
    glob(providedTranslationPathPattern, function (error, langFiles) {
      if (error) {
        reject(error);
      }
      langFiles.forEach(function (langFile) {
        const matches = langFile.match(providedTranslationPathRegex);
        if (matches) {
          targetLangArr.push({
            lang: matches[1],
            path: path.join(context.opts.projectRoot, langFile)
          });
        }
      });
      resolve(targetLangArr);
    });
  });
}

