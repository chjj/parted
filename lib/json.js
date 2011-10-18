/**
 * Parted JSON Parser
 * Copyright (c) 2011, Christopher Jeffrey (MIT License)
 */

var EventEmitter = require('events').EventEmitter
  , StringDecoder = require('string_decoder').StringDecoder
  , FreeList = require('freelist').FreeList;

/**
 * Parser
 */

var Parser = function(options) {
  if (!(this instanceof Parser)) {
    return new Parser(options);
  }

  EventEmitter.call(this);

  this.writable = true;
  this.readable = true;

  this.options = options || {};

  this._reset();
};

Parser.prototype.__proto__ = EventEmitter.prototype;

/**
 * Parsing
 */

Parser.prototype.write = function(data) {
  if (!this.writable) return;

  try {
    this._parse(data);
    this.written += data.length;
    this.emit('data', data.length);
  } catch(e) {
    this._error(e);
  }

  return true;
};

Parser.prototype.end = function(data) {
  if (!this.writable) return;

  if (data) this.write(data);

  this.writable = false;
  this.readable = false;

  if (this.value) {
    switch (this.state) {
      case 'number':
        this.assemble('number', +this.value);
        break;
      case 'value':
        this.assemble('string', this.value);
        break;
      default:
        return this._error('Unexpected EOF.');
    }
  }

  this.emit('end', this.data);

  this._reset();

  return true;
};

Parser.prototype._expect = function(ch, ex) {
  if (ch !== ex) {
    throw new
      Error('Unexpected `' + ch + '`.'
        + (ex ? ' Expected: `' + ex + '`.' : ''));
  }
};

Parser.prototype._unexpected = Parser.prototype._expect;

Parser.prototype._parse = function(data) {
  var data = this.decode.write(data)
    , i = 0
    , l = data.length
    , ch;

  for (; i < l; i++) {
    ch = data[i];
    switch (this.state) {
      case 'value': {
        switch (ch) {
          case '{':
            if (this.value) {
              return this._unexpected(ch);
            }
            this.assemble('object start');
            break;
          case '}':
            if (this.value) {
              this.assemble('string', this.value);
              this.value = '';
            }
            this.assemble('object end');
            break;
          case '[':
            if (this.value) {
              return this._unexpected(ch);
            }
            this.assemble('array start');
            break;
          case ']':
            if (this.value) {
              this.assemble('string', this.value);
              this.value = '';
            }
            this.assemble('array end');
            break;
          case '"':
            if (this.value) {
              return this._unexpected(ch);
            }
            this.state = 'string';
            break;
          case ',':
            if (this.value) {
              this.assemble('string', this.value);
              this.value = '';
            }
            break;
          case ':':
            if (!this.value) {
              return this._unexpected(ch);
            }
            this.assemble('object key', this.value);
            this.value = '';
            break;
          case '-':
          case '0':
          case '1':
          case '2':
          case '3':
          case '4':
          case '5':
          case '6':
          case '7':
          case '8':
          case '9':
            if (this.value) {
              return this._unexpected(ch);
            }
            this.state = 'number';
            this.value += ch;
            break;
          case 'f':
          case 'n':
          case 't':
            if (this.value) {
              return this._unexpected(ch);
            }
            this.state = ch;
            break;
          default:
            if (ch > ' ') {
              return this._unexpected(ch);
            }
            break;
        }
        break;
      }
      case 'number': {
        switch (ch) {
          case '}':
            // check last byte of .value
            // make sure it is a digit
            this.state = 'value';
            this.assemble('number', +this.value);
            this.value = '';
            this.assemble('object end');
            break;
          case ']':
            this.state = 'value';
            this.assemble('number', +this.value);
            this.value = '';
            this.assemble('array end');
            break;
          case ',':
            this.state = 'value';
            this.assemble('number', +this.value);
            this.value = '';
            break;
          case 'e':
          case 'E':
            if (!/\d$/.test(this.value)) {
              return this._unexpected(ch);
            }
            this.value += ch;
            break;
          case '-':
          case '+':
            if (!/e$/i.test(this.value)) {
              return this._unexpected(ch);
            }
            this.value += ch;
            break;
          case '.':
            if (/\.|e|.-|\+/i.test(this.value)
                || !/\d$/.test(this.value)) {
              return this._unexpected(ch);
            }
            this.value += ch;
            break;
          case '0':
          case '1':
          case '2':
          case '3':
          case '4':
          case '5':
          case '6':
          case '7':
          case '8':
          case '9':
            // json doesnt allow 0x numbers
            if (this.length === 1
                && this.value[0] === '0') {
              return this._unexpected(ch);
            }
            this.value += ch;
            break;
          default:
            if (ch <= ' ') {
              this.state = 'value';
              this.assemble('number', +this.value);
              this.value = '';
            } else {
              return this._unexpected(ch);
            }
            break;
        }
        break;
      }
      case 'string': {
        switch (ch) {
          case '"':
            this.state = 'value';
            // hack for empty strings
            if (!this.value) this.value = ' ';
            break;
          case '\\':
            this.state = 'escape';
            break;
          default:
            this.value += ch;
            break;
        }
        break;
      }
      case 'escape': {
        switch (ch) {
          case 'u':
            this.unicode = '';
            break;
          case 'b':
            this.value += '\b';
            break;
          case 'f':
            this.value += '\f';
            break;
          case 'n':
            this.value += '\n';
            break;
          case 'r':
            this.value += '\r';
            break;
          case 't':
            this.value += '\t';
            break;
          case '"':
          case '/':
          case '\\':
            this.value += ch;
            break;
          default:
            // json is supposed to throw
            // if there's a backslash
            // in the wrong spot
            return this._unexpected(ch);
        }
        if (ch === 'u') {
          this.state = 'unicode';
        } else {
          this.state = 'string';
        }
        break;
      }
      case 'unicode': {
        if ((ch >= '0' && ch <= '9')
            || (ch >= 'A' && ch <= 'F')
            || (ch >= 'a' && ch <= 'f')) {
          this.unicode += ch;
          if (this.unicode.length === 4) {
            this.unicode = parseInt(this.unicode, 16);
            this.value += String.fromCharCode(this.unicode);
            this.unicode = '';
            this.state = 'string';
          }
        } else {
          return this._unexpected(ch);
        }
        break;
      }
      case 'n': {
        this._expect(ch, 'u');
        this.state = 'nu';
        break;
      }
      case 'nu': {
        this._expect(ch, 'l');
        this.state = 'nul';
        break;
      }
      case 'nul': {
        this._expect(ch, 'l');
        this.assemble('null', null);
        this.state = 'value';
        break;
      }
      case 'f': {
        this._expect(ch, 'a');
        this.state = 'fa';
        break;
      }
      case 'fa': {
        this._expect(ch, 'l');
        this.state = 'fal';
        break;
      }
      case 'fal': {
        this._expect(ch, 's');
        this.state = 'fals';
        break;
      }
      case 'fals': {
        this._expect(ch, 'e');
        this.assemble('boolean', false);
        this.state = 'value';
        break;
      }
      case 't': {
        this._expect(ch, 'r');
        this.state = 'tr';
        break;
      }
      case 'tr': {
        this._expect(ch, 'u');
        this.state = 'tru';
        break;
      }
      case 'tru': {
        this._expect(ch, 'e');
        this.assemble('boolean', true);
        this.state = 'value';
        break;
      }
    }
  }
};

/**
 * Object Assembler
 */

Parser.prototype.assemble = function(type, val) {
  switch (type) {
    case 'object start':
      var object = {};
      this.assemble('value', object);
      this.stack.push(object);
      break;
    case 'object key':
      if (this.key) {
        return this._unexpected(type);
      }
      this.key = val;
      break;
    case 'object end':
      if (this.key) {
        return this._unexpected(type);
      }
      this.emit('object', this.stack.pop());
      break;
    case 'array start':
      var array = [];
      this.assemble('value', array);
      this.stack.push(array);
      break;
    case 'array end':
      this.emit('array', this.stack.pop());
      break;
    case 'number':
    case 'string':
    case 'boolean':
    case 'null':
      this.emit(type, val);
      this.assemble('value', val);
      break;
    case 'value':
      var top = this.stack[this.stack.length-1];
      if (!top) {
        if (this.key) {
          return this._error('Unexpected key.');
        }
        this.data = val;
        this.stack.push(val);
        return;
      }
      if (!this.key) {
        if (!Array.isArray(top)) {
          return this._error('Expected key.');
        }
        top.push(val);
      } else {
        if (Array.isArray(top)) {
          return this._error('Unexpected key.');
        }
        top[this.key] = val;
        this.key = null;
      }
      break;
  }
};

Parser.prototype._reset = function() {
  this.stack = [];
  this.key = null;
  this.data = null;

  this.state = 'value';
  this.value = '';
  this.unicode = '';
  this.written = 0;
  this.decode = new StringDecoder('utf8');
  this._events = {};
};

Parser.prototype._error = function(err) {
  this.destroy();
  this.emit('error', typeof err === 'string'
    ? new Error(err)
    : err);
};

Parser.prototype.destroy = function(err) {
  this.writable = false;
  this.readable = false;
  this._reset();
};

/**
 * Legacy
 */

Parser.create = function(options) {
  return new Parser(options);
};

/**
 * Pool
 */

//var parsers = new FreeList('parsers', 20, function() {
//  return new Parser();
//});

/**
 * Expose
 */

module.exports = exports = Parser;

exports.middleware = function(options) {
  return function(req, res, next) {
    if (req.method === 'GET'
        || req.method === 'HEAD'
        || req._json) return next();

    req._json = true;

    var type = req.headers['content-type'];

    if (type) type = type.split(';')[0].trim().toLowerCase();

    if (type === 'application/json') {
      exports.handle(req, res, next, options);
    } else {
      if (options.ensureBody) {
        req.body = {};
      }
      next();
    }
  };
};

exports.handle = function(req, res, next, options) {
  var parser = new Parser(options) //parsers.alloc()
    , limit = options.jsonLimit || options.limit;

  parser.on('error', function(err) {
    req.destroy();
    next(err);
  });

  parser.on('end', function(data) {
    //parsers.free(parser);
    req.body = data;
    next();
  });

  if (limit) {
    parser.on('data', function() {
      if (this.written > limit) {
        this.emit('error', new Error('Overflow.'));
        this.destroy();
      }
    });
  }

  req.body = {};
  req.pipe(parser);
};
