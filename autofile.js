'use strict';

var https   = require('https');
var fs      = require('fs');

// -----------------------------------------------------------------------------

function getKeywordSearchPath(keyword) {
    return '/-/_view/byKeyword?startkey=["' + keyword + '"]&endkey=["' + keyword + '",{}]&group_level=3';
}

function inspect(x, depth) {
    return require('util').inspect(x, false, depth || 10, true);
}

var stopWordsIdx = {};
function isStopWord(word) {
    // if stopwords haven't been loaded, load them
    if (!stopWordsIdx) {
        var stopWords = fs.readFile('./stopwords').toString().split('\n');
        for (var k in stopWords) {
            stopWordsIdx[stopWords[k]] = null;
        }
    }

    return stopWordsIdx.hasOwnProperty(word);
}

function tokenize(str) {
    var tokens = str
        .toLowerCase()
        // remove undesired characters
        .replace(/['"]/, '')
        // replace space equivalent chars
        .replace(/[\-_\/\\+\(\)\[\]&%$#,\.:;\|<>{}@!\?]/g, ' ')
        // collapse spaces
        .replace(/\s\s+/g, ' ')
        // tokenize
        .split(' ');

    // filter out stopwords
    var result = [];
    var token;
    for (var i in tokens) {
        token = tokens[i];
        if (!isStopWord(token)) {
            result.push(token);
        }
    }

    return result;
}

function rank() {
    // ranking is as follows:
    // - task name has a 2x factor
    // - ranking is normalized between 0 and 1
    // - 1 is the best match of the resultset
}

// -----------------------------------------------------------------------------

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
            on:          '{{update-cache}}',

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
            on:          '{{update-cache}}',

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
            description: 'Build index',
            on:          '{{update-cache}}',

            task: function (opt, ctx, next) {
                var tasks = opt.registryData;
                var i     = 0;
                var idx   = opt.registryDataIdx = {
                    // holds mapping of id => task name
                    lookup: {},
                    fields: {
                        // indexes of token => [ task ids ]
                        name:        {},
                        description: {}
                    }
                };
                var nameTokens, descriptionTokens;

                // TODO: optimize and refactor indexing below
                // for each of the tasks
                for (var name in tasks) {
                    var task = tasks[name];

                    task.id = i++;

                    // store mapping of id => task id
                    idx.lookup[task.id] = name;

                    // tokenize name and description
                    nameTokens        = tokenize(name);
                    descriptionTokens = tokenize(task.description);

                    // index tokens from name
                    nameTokens.forEach(function (token) {
                        // if first occurrence of token, initialize entry
                        if (!idx.fields.name[token]) {
                            idx.fields.name[token] = [];
                        }

                        idx.fields.name[token].push(task.id);
                    });

                    
                    // index tokens from description
                    descriptionTokens.forEach(function (token) {
                        // if first occurrence of token, initialize entry
                        if (!idx.fields.description[token]) {
                            idx.fields.description[token] = [];
                        }

                        idx.fields.description[token].push(task.id);
                    });
                }

                next();
            }
        },
        {
            description: 'Cache index',
            on:          '{{update-cache}}',

            task: function (opt, ctx, next) {
                // TODO: cache index
                ctx.log.warnln('Should cache index');
                next();
            }
        },
        {
            description: 'Load task index',
            on:          '{{!update-cache}}',

            task: function (opt, ctx, next) {
                // TODO: load index cache
                ctx.log.warnln('Should load the task from index');
                next();
            }
        },
        {
            description: 'Look for matches in index',

            task: function (opt, ctx, next) {
                // look up occurrences of the query tokens in indexed tasks
                var queryTokens = tokenize(opt.query);
                var hits = {
                    name: {},
                    description: {}
                };

                queryTokens.forEach(function (token) {
                    opt.registryDataIdx.fields.name[token].forEach(function (hitId) {
                        hits.name[hitId] = hits.name[hitId] ? hits.name[hitId] + 1 : 1;
                    });

                    opt.registryDataIdx.fields.description[token].forEach(function (hitId) {
                        hits.description[hitId] = hits.description[hitId] ? hits.description[hitId] + 1 : 1;
                    });
                });



                // rank results


                console.log(hits);
                for (var hitId in hits.name) {
                    console.log(opt.registryDataIdx.lookup[parseInt(hitId)], hits.name[hitId]);
                }

                for (hitId in hits.description) {
                    console.log(opt.registryDataIdx.lookup[parseInt(hitId)], hits.description[hitId]);
                }

                next();
            }
        }
    ]
};

module.exports = task;