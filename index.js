'use strict';

var Indexer = require('indexer');

var users = [
    { name: 'sheryl', age: 33 },
    { name: 'jaydee', age: 32 },
    { name: 'addie', age: 0.33 },
    { name: 'jayden', age: 31 },
    { name: 'adrienne', age: 13 },
    { name: 'jaime', age: 12 },
    { name: 'james', age: 11 },
    { name: 'adelle', age: 24 },
    { name: 'sheila', age: 22 },
    { name: 'marco oliveira', age: 22 },
    { name: 'shermaine', age: 19 }
];

function populateIndex(index, field, records) {
    for (var i = 0, n = records.length; i < n; ++i) {
        index.add(records[i][field], i);
    }
}

var index = Indexer.create('name');

populateIndex(index, 'name', users);

console.log(
    'Matching entries for [jaydee]: ' + index.search('jaydee') + '\n' +
    'Matching entries for [adrienne]: ' + index.search('adrienne') + '\n' +
    'Matching entries for [marco oliveira]: ' + index.search('marco oliveira') + '\n' +
    'Matching entries for [22]: ' + index.search(22) + '\n' +
    'Matching entries for [shermaine]: ' + index.search('shermaine')
);