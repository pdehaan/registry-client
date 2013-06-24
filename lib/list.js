var path = require('path');
var url = require('url');
var async = require('async');
var request = require('request');
var Cache = require('./util/Cache');
var createError = require('./util/createError');

function list(callback) {
    var data = [];
    var that = this;
    var registry = this._config.registry.search;
    var total = registry.length;
    var index = 0;

    // If no registry entries were passed, simply
    // error with package not found
    if (!total) {
        return callback(null, []);
    }

    // Lookup package in series in each registry
    // endpoint until we got the data
    async.doUntil(function (next) {
        var remote = url.parse(registry[index]);
        var listCache = that._listCache[remote.host];

        // If offline flag is passed, only query the cache
        if (that._config.offline) {
            return listCache.get('list', function (err, results) {
                if (err || !results) {
                    return next(err);
                }

                // Add each result
                results.forEach(function (result) {
                    addResult(data, result);
                });

                next();
            });
        }

        // Otherwise make a request to always obtain fresh data
        doRequest(index, that._config, function (err, results) {
            if (err || !results) {
                return next(err);
            }

            // Add each result
            results.forEach(function (result) {
                addResult(data, result);
            });

            // Store in cache for future offline usage
            listCache.set('list', results, getMaxAge(), next);
        });
    }, function () {
        // Until the data is unknown or there's still registries to test
        return index++ < total;
    }, function (err) {
        // Clear runtime cache, keeping the persistent data
        // in files for future offline usage
        clearRuntimeCache();

        // If some of the registry entries failed, error out
        if (err) {
            return callback(err);
        }

        callback(null, data);
    });
}

function addResult(accumulated, result) {
    var exists = accumulated.some(function (current) {
        return current.name === result.name;
    });

    if (!exists) {
        accumulated.push(result);
    }
}

function doRequest(index, config, callback) {
    var requestUrl = config.registry.search[index] + '/packages';
    var remote = url.parse(requestUrl);
    var headers = {};

    if (config.userAgent) {
        headers['User-Agent'] = config.userAgent;
    }

    request.get(requestUrl, {
        proxy: remote.protocol === 'https:' ? config.httpsProxy : config.proxy,
        ca: config.ca.search[index],
        strictSSL: config.strictSsl,
        timeout: config.timeout,
        json: true
    }, function (err, response, body) {
        // If there was an internal error (e.g. timeout)
        if (err) {
            return callback(createError('Request to ' + requestUrl + ' failed: ' + err.message, err.code));
        }

        // Abort if there was an error (range different than 2xx)
        if (response.statusCode < 200 || response.statusCode > 299) {
            return callback(createError('Request to ' + requestUrl + ' failed with ' + response.statusCode, 'EINVRES'));
        }

        // Validate response body, since we are expecting a JSON object
        // If the server returns an invalid JSON, it's still a string
        if (typeof body !== 'object') {
            return callback(createError('Response of request to ' + requestUrl + ' is not a valid json', 'EINVRES'));
        }

        callback(null, body);
    });
}

function getMaxAge() {
    // Make it 5 minutes
    return 5 * 60 * 60 * 1000;
}

function initCache() {
    this._listCache = this._cache.list || {};

    // Generate a cache instance for each registry endpoint
    this._config.registry.search.forEach(function (registry) {
        var cacheDir;
        var host = url.parse(registry).host;

        // Skip if there's a cache for the same host
        if (this._listCache[host]) {
            return;
        }

        if (this._config.cache) {
            cacheDir = path.join(this._config.cache, encodeURIComponent(host), 'list');
        }

        this._listCache[host] = new Cache(cacheDir, {
            max: 250,
            // If offline flag is passed, we use stale entries from the cache
            useStale: this._config.offline
        });
    }, this);
}

function clearCache(callback) {
    var listCache = this._listCache;
    var remotes = Object.keys(listCache);

    // There's only one key, which is 'list'..
    // But we clear everything anyway
    async.forEach(remotes, function (remote, next) {
        listCache[remote].clear(next);
    }, callback);
}

function clearRuntimeCache() {
    var remote;

    for (remote in this._listCache) {
        this._listCache[remote].reset();
    }
}

list.initCache = initCache;
list.clearCache = clearCache;
list.clearRuntimeCache = clearRuntimeCache;

module.exports = list;