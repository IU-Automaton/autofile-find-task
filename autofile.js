'use strict';

var https   = require('https');
var fs      = require('fs');
var Tabular = require('tabular');
var colors  = require('colors');

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

function getScore(queryTokens, subjectTokens) {
    var zeroScore = {
        precision: 0,
        recall:    0,
        f1score:   0
    };

    if (!queryTokens.length || !subjectTokens.length) {
        return zeroScore;
    }

    var intersectionCount = arrayIntersection(queryTokens, subjectTokens).length;

    if (!intersectionCount) {
        return zeroScore;
    }

    var precision = intersectionCount / queryTokens.length;
    var recall    = intersectionCount / subjectTokens.length;

    return {
        precision: precision,
        recall:    recall,
        f1score:   2 * (precision * recall) / (precision + recall)
    };
}

function arrayIntersection(a, b) {
    var aLength = a.length,
        result  = [],
        j       = 0;

    for (var i = 0; i < aLength; ++i) {
        if (b.indexOf(a[i]) !== -1) {
            result[j++] = a[i];
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
        },
        score_threshold: {
            description: 'The score threshold that a match must reach for ' +
                         'being included in the search results',
            'default': 0.2
        }
    },

    filter: function (opt, ctx, next) {
        if (true/* TODO: if cache is considered outdated*/) {
            opt['update-cache'] = true;
        }

        next();
    },

    tasks: [
        {
            description: 'Fetch information from NPM registry',
            on:          '{{update-cache}}',

            task: function (opt, ctx, next) {
                opt.registryData = '';

                // // TODO: remove hack below
                // opt.registryData = require('./registryData.json');
                // next();

            // TODO: uncomment below
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

                var results = [],
                    result;
                var hit, nameScore, descriptionScore;
                var queryTokens = tokenize(opt.query);
                for (var name in opt.hits) {
                    hit              = opt.hits[name];
                    nameScore        = getScore(queryTokens, tokenize(name));
                    descriptionScore = getScore(queryTokens, tokenize(opt.registryData[name].description));
                    result = {
                        name:        name,
                        description: opt.registryData[name].description,

                        f1score: {
                            name:        nameScore.f1score,
                            description: descriptionScore.f1score
                        },
                        precision: {
                            name:        nameScore.precision,
                            description: descriptionScore.precision
                        },
                        recall: {
                            name:        nameScore.recall,
                            description: descriptionScore.recall
                        }
                    };

                    result.weight = result.f1score.name * opt.name_factor + result.f1score.description * opt.description_factor;

                    // if score is good enough, include in results
                    if (result.weight > opt.score_threshold) {
                        results.push(result);
                    }
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
                    ctx.log.successln('\nSearch results:\n');

                    var tab = new Tabular({
                        marginLeft: 2
                    });

                    opt.results.forEach(function (result) {
                        tab.push([result.name.grey, result.description]);
//                        ctx.log.infoln(result.weight, result.name);
//                        ctx.log.infoln('  ', result.description + '\n');
                    });

                    ctx.log.infoln(tab.get());

                    ctx.log.infoln('\nTo install a module, simply run `npm install module_name`.\n');

                } else {
                    ctx.log.errorln('Could not find any result');
                }
                
                next();
            }
        }
    ]
};

module.exports = task;