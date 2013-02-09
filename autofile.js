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
    // TODO: support stemming and fuzzy match
    // TODO: support alternative forms of tokens (sass => sass + scss)

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
    var alreadyInResult = {};
    for (var i in tokens) {
        token = tokens[i];
        if (!isStopWord(token) && !alreadyInResult[token]) {
            alreadyInResult[token] = true;
            result.push(token);
        }
    }

    return result;
}

// -----------------------------------------------------------------------------

var task = {
    id: 'find-task',
    author: 'Indigo United',
    name: 'Find task',

    options: {
        'clear-cache': {
            description: 'If the NPM registry cache should be updated',
            'default': false
        },
        query: {
            description: 'What to search for'
        },
        keyword: {
            description: 'The keyword that should be used to perform the ' +
                         'filter on NPM',
            'default': 'gruntplugin'
        },
        name_factor: {
            description: 'The factor to apply to the task name when ranking',
            'default': 4
        },
        description_factor: {
            description: 'The factor to apply to the task description when' +
                         ' ranking',
            'default': 1
        }
    },

    filter: function (opt, ctx, next) {
        if (true/* cache is considered outdated*/) {
            opt['update-cache'] = true;
        }

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
                    path: getKeywordSearchPath(opt.keyword),
                    method: 'GET'
                };

                opt.registryData = '';

                var registryUrl = 'https://registry.npmjs.org' + getKeywordSearchPath(opt.keyword);
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

                // TODO: maybe create an afinity graph, which relates tokens
                // to all the other tokens, based on the amount of times they
                // appear together, so that the search can be tweaked a bit?

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

                // TODO: remove tokens that are too common

                next();
            }
        },
        {
            description: 'Cache registry data and task index',
            on:          '{{update-cache}}',

            task: function (opt, ctx, next) {
                // TODO: cache index and registry data
                // remember to use the keyword as part of the filename
                ctx.log.warnln('Should cache index');
                next();
            }
        },
        {
            description: 'Load registry data and task index from cache',
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
                var hits = {};

                var idxFields = opt.registryDataIdx.fields;
                // list of indexed fields
                var fields    = ['name', 'description'];

                // for each query token
                tokenize(opt.query).forEach(function (token) {
                    // for each of the indexed fields
                    fields.forEach(function (field) {
                        // if there is no hit for a specific token, skip
                        if (!idxFields[field][token]) {
                            return;
                        }
                        // for each of the tasks that have that token on the
                        // field
                        idxFields[field][token].forEach(function (hitId) {
                            // if this is the first hit for this task
                            if (!hits[hitId]) {
                                // add it to hit list
                                hits[hitId] = {};
                            }
                            // increment hit count of the field for this doc
                            hits[hitId][field] = hits[hitId][field] ?
                                hits[hitId][field] + 1
                                : 1;
                        });
                    });
                });

                var lookup = opt.registryDataIdx.lookup;
                opt.hits   = {};
                for (var hitId in hits) {
                    opt.hits[lookup[parseInt(hitId, 10)]] = hits[hitId];
                }

                ctx.log.debugln('Hits:', inspect(opt.hits));

                next();
            }
        },
        {
            description: 'Rank matches',

            task: function (opt, ctx, next) {
                // TODO: improve ranker:
                //   - consider token order and distance
                //   - consider how rare a token is
                //   - maybe perform a token "AND" with a quorum (miss threshold)

                var results = [];
                var hit;
                for (var name in opt.hits) {
                    hit = opt.hits[name];
                    results.push({
                        name:        name,
                        description: opt.registryData[name].description,
                        weight:      hit.name        ? hit.name * opt.name_factor               : 0 +
                                     hit.description ? hit.description * opt.description_factor : 0
                    });
                }

                results.sort(function (a, b) {
                    if (a.weight > b.weight) {
                        return -1;
                    } else if (a.weight < b.weight) {
                        return 1;
                    }

                    return 0;
                });

                opt.results = results;

                ctx.log.debugln('Ranked results:', inspect(results));

                next();
            }
        },
        {
            description: 'Output results',

            task: function (opt, ctx, next) {
                if (opt.results.length > 0) {
                    ctx.log.successln('Search results:');
                    opt.results.forEach(function (result) {
                        ctx.log.infoln(result.name)
                        ctx.log.infoln('  ', result.description + '\n');
                    });
                } else {
                    ctx.log.errorln('Could not find any result');
                }
                
            }
        }
    ]
};

module.exports = task;