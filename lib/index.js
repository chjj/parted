/**
 * Parted (https://github.com/chjj/parted)
 * Streaming Body Parsers
 * Copyright (c) 2011, Christopher Jeffrey (MIT License)
 */

var StringDecoder = require('string_decoder').StringDecoder;

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
    if (req.method === 'GET'
        || req.method === 'HEAD'
        || req.body) return next();

    req.body = {};

    var type = req.headers['content-type']
      , parser;

    if (!type) return next();

    type = type.split(';')[0].trim().toLowerCase();

    if (type === 'multipart/form-data') {
      load('./multipart').handle(req, res, next, options);
      return;
    }

    switch (type) {
      case 'application/x-www-form-urlencoded':
        parser = qs;
        break;
      case 'application/json':
        parser = json;
        break;
      default:
        return next();
    }

    handle(req, next, options, parser);
  };
};

/**
 * Handler
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

/**
 * Expose
 */

module.exports = exports;
