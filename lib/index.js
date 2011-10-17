/**
 * Parted
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
        load('./parted').handle(req, res, next, options);
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
  return load('./parted');
});

exports.__defineGetter__('encoded', function() {
  return load('./encoded');
});

exports.__defineGetter__('json', function() {
  return load('./json');
});

/**
 * Expose
 */

module.exports = exports;
