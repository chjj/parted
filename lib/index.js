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
 * Middleware
 */

exports = function(options) {
  options = options || {};

  return function(req, res, next) {
    req.body = {};

    if (req.method === 'GET'
        || req.method === 'HEAD'
        || req._parted) return next();

    req._parted = true;

    var type = req.headers['content-type']
      , parser;

    if (!type) return next();

    type = type.split(';')[0].trim().toLowerCase();

    switch (type) {
      case 'multipart/form-data':
        return load('./multipart').handle(req, res, next, options);
      case 'application/x-www-form-urlencoded':
        return options.stream
          ? load('./encoded').handle(req, res, next, options)
          : handle(req, next, options, load('./qs').parse);
      case 'application/json':
        return options.stream
          ? load('./json').handle(req, res, next, options)
          : handle(req, next, options, JSON.parse);
      default:
        return next();
    }
  };
};

/**
 * Buffering Handler
 */

var handle = function(req, next, options, parser) {
  var decode = new StringDecoder('utf8')
    , total = 0
    , body = '';

  req.on('data', function(data) {
    total += data.length;

    if (total > options.limit) {
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

exports.__defineGetter__('json', function() {
  return load('./json');
});

exports.__defineGetter__('encoded', function() {
  return load('./encoded');
});

exports.__defineGetter__('qs', function() {
  return load('./qs');
});

/**
 * Expose
 */

module.exports = exports;
