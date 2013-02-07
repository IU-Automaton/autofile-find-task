'use strict';

var https = require('https');

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
            description: 'Build index from NPM registry data',
            on: '{{update-cache}}',
            task: function (opt, ctx, next) {
                ctx.log.debugln('Going to build index from', inspect(opt.registryData));

                next();
            }
        }
    ]
};

module.exports = task;