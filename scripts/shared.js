export function getTargetLang(context) {
    let targetLangArr = [];
    const deferred = context.requireCordovaModule('q').defer();
    const path = context.requireCordovaModule('path');
    const glob = context.requireCordovaModule('glob');

    glob("../res/lang/*/translations.json", function (err, langFiles) {
        if (err) {
            deferred.reject(err);
        } else {
            langFiles.forEach(function (langFile) {
                const matches = langFile.match(/\/res\/lang\/(.*)\/translations.json/);
                if (matches) {
                    const langString = matches[1].split('_')[0]
                    targetLangArr.push({
                        lang: langString,
                        path: path.join(context.opts.projectRoot, langFile)
                    });
                }
            });
            deferred.resolve(targetLangArr);
        }
    });
    return deferred.promise;
}
