const server = require('./server');
const assert = require('assert').strict;
const should = require("mocha-should");
const expect = require("chai").expect;

describe("Exchange rates test case", function() {
    this.timeout(0)
    it("should call basic getter", function() {
        if (typeof server === 'object' && server !== null) {
        console.log(Object.keys(server));
        } else {
        console.log('server not object');
        }
    });
});
