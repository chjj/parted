/**
 * Parted (https://github.com/chjj/parted)
 * Streaming Body Parsers
 * Copyright (c) 2011, Christopher Jeffrey (MIT License)
 */

/**
 * Faster Require Cache
 */

var modules = {};
var load = function(name) {
  if (modules[name]) return modules[name];
  return modules[name] = require(name);
};

/**
 * Middleware
 */

exports = function(options) {
  // LEGACY
  if (typeof options === 'string')
    return new exports.multipart(arguments[0], arguments[1]);

  return function(req, res, next) {
    if (req.method === 'GET'
        || req.method === 'HEAD'
        || req.body) return next();

    req.body = {};

    var type = req.headers['content-type'];
    if (!type) return next();

    type = type.split(';')[0].trim().toLowerCase();

    switch (type) {
      case 'multipart/form-data':
        load('./multipart').handle(req, res, next, options);
        break;
      case 'application/x-www-form-urlencoded':
        load('./encoded').handle(req, res, next, options);
        break;
      case 'application/json':
        load('./json').handle(req, res, next, options);
        break;
      default:
        next();
        break;
    }
  };
};

/**
 * Individual Access
 */

exports.__defineGetter__('multipart', function() {
  return load('./multipart');
});

exports.__defineGetter__('encoded', function() {
  return load('./encoded');
});

exports.__defineGetter__('json', function() {
  return load('./json');
});

/**
 * Legacy
 */

exports.__defineGetter__('root', function() {
  return exports.multipart.root;
});

exports.__defineSetter__('root', function(val) {
  return exports.multipart.root = val;
});

exports.__defineGetter__('middleware', function() {
  return exports.multipart.middleware;
});

/**
 * Expose
 */

module.exports = exports;
