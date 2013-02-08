'use strict';

var https = require('https');
var fs    = require('fs');

function getKeywordSearchPath(keyword) {
    return '/-/_view/byKeyword?startkey=["' + keyword + '"]&endkey=["' + keyword + '",{}]&group_level=3';
}

function inspect(x, depth) {
    return require('util').inspect(x, false, depth || 10, true);
}

var task = {
    id: 'task',
    author: 'Indigo United',
    name: 'create task',

    options: {
        'clear-cache': {
            description: 'If the NPM registry cache should be updated',
            'default': false
        },
        query: {
            description: 'What to search for'
        }
    },

    filter: function (opt, ctx, next) {
        if (true/* cache is considered outdated*/) {
            opt['update-cache'] = true;
        }

        //opt.taskPrefix = 'automaton-';
        opt.taskPrefix = 'gruntplugin';

        next();
    },

    tasks: [
        {
            description: 'Fetch information from NPM registry',
            on: '{{update-cache}}',
            task: function (opt, ctx, next) {
                var reqOpt = {
                    hostname: '',
                    port: 80,
                    path: getKeywordSearchPath(opt.taskPrefix),
                    method: 'GET'
                };

                opt.registryData = '';

                var registryUrl = 'https://registry.npmjs.org' + getKeywordSearchPath(opt.taskPrefix);
                ctx.log.debugln('Going to fetch data from', registryUrl);
                var req = https.get(registryUrl, function (res) {
                    if (res.statusCode !== 200) {
                        return next(new Error('Unexpected HTTP status code while fetching data from NPM registry: ' + res.statusCode));
                    }

                    ctx.log.debugln('Starting response');

                    res.on('data', function (chunk) {
                        ctx.log.debug('.');
                        opt.registryData += chunk;
                    });

                    res.on('end', function () {
                        ctx.log.debugln('Response ready');
                        opt.registryData = JSON.parse(opt.registryData);

                        next();
                    });

                });

                req.on('error', function (err) {
                    return next(new Error('Error fetching data from NPM registry: ' + err));
                });
            }
        },
        {
            description: 'Parse NPM registry data',
            on: '{{update-cache}}',
            task: function (opt, ctx, next) {
                ctx.log.debugln('Going to build index');

                var tasks = {};

                var rows = opt.registryData.rows;

                for (var k in opt.registryData.rows) {
                    tasks[rows[k].key[1]] = {
                        description: rows[k].key[2]
                    };
                }

                ctx.log.debugln('result:', inspect(tasks));

                opt.registryData = tasks;

                next();
            }
        },
        {
            description: 'Prepare stop words',
            on: '{{update-cache}}',
            task: function (opt, ctx, next) {
                ctx.log.debugln('Building stopword index');
                var stopWordsIdx = {};
                
                fs.readFile('./stopwords', function (err, data) {
                    if (err) {
                        return next(new Error('Could not read stopwords file: ' + err));
                    }

                    var stopWords = data.toString().split('\n');
                    for (var k in stopWords) {
                        stopWordsIdx[stopWords[k]] = null;
                    }

                    opt.stopWordsIdx = stopWordsIdx;

                    ctx.log.debugln(inspect(stopWordsIdx));

                    next();
                });
            }
        },
        {
            description: 'Build index from registry data',
            on: '{{update-cache}}',
            task: function (opt, ctx, next) {
                next();
            }
        },
        {
            description: 'Load task index',
            on: '{{!update-cache}}',
            task: function (opt, ctx, next) {
                next();
            }
        }
    ]
};

module.exports = task;