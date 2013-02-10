/**
 * Parted Encoded/QS Parser
 * Copyright (c) 2011, Christopher Jeffrey (MIT License)
 */

var EventEmitter = require('events').EventEmitter
  , StringDecoder = require('string_decoder').StringDecoder;

var qs = require('./qs')
  , unescape = qs.unescape
  , set = qs.set;

/**
 * Character Constants
 */

var AMP = '&'.charCodeAt(0)
  , EQUAL = '='.charCodeAt(0);

/**
 * Parser
 */

var Parser = function(options) {
  if (!(this instanceof Parser)) {
    return new Parser();
  }

  EventEmitter.call(this);

  this.readable = true;
  this.writable = true;

  this.options = options || {};

  this.state = 'key';
  this.buff = '';
  this.key = '';
  this.decode = new StringDecoder('utf8');
  this.written = 0;
};

Parser.prototype.__proto__ = EventEmitter.prototype;

Parser.prototype.write = function(data) {
  if (!this.writable) return;

  try {
    this._parse(data);
    this.written += data.length;
  } catch (e) {
    this._error(e);
  }

  this.emit('data', data);
};

Parser.prototype.end = function(data) {
  if (!this.writable) return;

  if (data) this.write(data);

  // always left in the buffer
  if (this.buff) {
    if (this.key) {
      this.emit('value', this.key, unescape(this.buff));
    } else {
      this.emit('value', unescape(this.buff), '');
    }
  }

  this.emit('end');
};

Parser.prototype._parse = function(data) {
  var i = 0
    , j = 0
    , l = data.length
    , ch;

  for (; i < l; i++) {
    ch = data[i];
    switch (this.state) {
      case 'key':
        switch (ch) {
          case EQUAL:
            this.state = 'value';
            this.buff += this.decode.write(data.slice(j, i));
            this.key = unescape(this.buff);
            this.buff = '';
            j = i + 1;
            break;
          case AMP:
            // they did this: ...&key&...
            // no state change
            // this.state = 'key';
            this.buff += this.decode.write(data.slice(j, i));
            this.key = unescape(this.buff);
            this.emit('value', this.key, '');
            this.buff = '';
            this.key = '';
            j = i + 1;
            break;
        }
        break;
      case 'value':
        switch (ch) {
          case AMP:
            this.state = 'key';
            this.buff += this.decode.write(data.slice(j, i));
            this.emit('value', this.key, unescape(this.buff));
            this.key = '';
            this.buff = '';
            j = i + 1;
            break;
          case EQUAL:
            // this should be encoded
            return this._error('Unexpected EQUAL.');
        }
        break;
    }
  }

  if (j < data.length) {
    this.buff += this.decode.write(data.slice(j));
  }
};

Parser.prototype._error = function(err) {
  this.destroy();
  this.emit('error', typeof err === 'string'
    ? new Error(err)
    : err);
};

Parser.prototype.destroy = function() {
  this.writable = false;
  this.readable = false;
};

/**
 * Middleware
 */

Parser.middleware = function(options) {
  return function(req, res, next) {
    if (options.ensureBody) {
      req.body = {};
    }

    if (req.method === 'GET'
        || req.method === 'HEAD'
        || req._encoded) return next();

    req._encoded = true;

    var type = req.headers['content-type'];

    if (type) type = type.split(';')[0].trim().toLowerCase();

    if (type == 'application/x-www-form-urlencoded') {
      Parser.handle(req, res, next, options);
    } else {
      next();
    }
  };
};

/**
 * Handler
 */

Parser.handle = function(req, res, next, options) {
  var parser = new Parser(options)
    , data = {}
    , limit = options.limit;

  parser.on('value', function(field, value) {
    set(data, field, value);
  });

  parser.on('end', function() {
    next();
  });

  parser.on('error', function(err) {
    req.destroy();
    next(err);
  });

  parser.on('data', function() {
    if (this.written > limit) {
      this.emit('error', new Error('Overflow.'));
      this.destroy();
    }
  });

  req.body = data;
  req.pipe(parser);
};

/**
 * Expose
 */

module.exports = Parser;
