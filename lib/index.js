/**
 * Parted (https://github.com/chjj/parted)
 * Streaming Body Parsers
 * Copyright (c) 2011, Christopher Jeffrey (MIT License)
 */

var StringDecoder = require('string_decoder').StringDecoder;

/**
 * Faster Require Cache
 */

var modules = {};
var load = function(name) {
  if (modules[name]) return modules[name];
  return modules[name] = require(name);
};

/**
 * Parsers
 */

var json = JSON.parse
  , qs;

try {
  qs = require('qs').parse;
} catch(e) {
  qs = require('querystring').parse;
}

/**
 * Middleware
 */

exports = function(options) {
  options = options || {};

  // LEGACY
  options.limit = options.encodedLimit
               || options.jsonLimit
               || options.limit;

  options.diskLimit = options.multipartLimit
                   || options.diskLimit
                   || options.limit;

  // LEGACY
  if (typeof options === 'string') {
    return new exports.multipart(arguments[0], arguments[1]);
  }

  return function(req, res, next) {
    if (req.method === 'GET'
        || req.method === 'HEAD'
        || req.body) return next();

    req.body = {};

    var type = req.headers['content-type'];
    if (!type) return next();

    type = type.split(';')[0].trim().toLowerCase();

    if (type === 'multipart/form-data') {
      load('./multipart').handle(req, res, next, options);
      return;
    }

    switch (type) {
      case 'application/x-www-form-urlencoded':
        return options.stream
          ? load('./encoded').handle(req, res, next, options)
          : handle(req, next, options, qs);
      case 'application/json':
        return options.stream
          ? load('./json').handle(req, res, next, options)
          : handle(req, next, options, json);
      default:
        return next();
    }
  };
};

var handle = function(req, next, options, parser) {
  var decode = new StringDecoder('utf8')
    , total = 0
    , body = '';

  req.on('data', function(data) {
    if (total += data.length > options.limit) {
      return req.emit('error', new Error('Overflow.'));
    }
    body += decode.write(data);
  });

  req.on('error', function(err) {
    req.destroy();
    next(err);
  });

  req.on('end', function() {
    try {
      if (body) {
        req.body = parser(body);
      }
    } catch (e) {
      return next(e);
    }
    next();
  });
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
