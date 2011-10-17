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
        this.emit('number', +this.value);
        break;
      case 'value':
        this.emit('string', this.value);
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
            this.emit('object start');
            break;
          case '}':
            if (this.value) {
              this.emit('string', this.value);
              this.value = '';
            }
            this.emit('object end');
            break;
          case '[':
            this.emit('array start');
            break;
          case ']':
            if (this.value) {
              this.emit('string', this.value);
              this.value = '';
            }
            this.emit('array end');
            break;
          case '"':
            this.state = 'string';
            break;
          case ',':
            if (this.value) {
              this.emit('string', this.value);
              this.value = '';
            }
            break;
          case ':':
            this.emit('object key', this.value);
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
              return this._error(this.value
                + ' in buffer before literal.'
              );
            }
            this.state = 'number';
            this.value += ch;
            break;
          case 'f':
          case 'n':
          case 't':
            if (this.value) {
              return this._error(this.value
                + ' in buffer before literal.'
              );
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
            this.state = 'value';
            this.emit('number', +this.value);
            this.value = '';
            this.emit('object end');
            break;
          case ']':
            this.state = 'value';
            this.emit('number', +this.value);
            this.value = '';
            this.emit('array end');
            break;
          case ',':
            this.state = 'value';
            this.emit('number', +this.value);
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
            ; // FALL-THROUGH
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
            this.value += ch;
            break;
          default:
            if (ch <= ' ') {
              this.state = 'value';
              this.emit('number', +this.value);
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
            this.value += ch;
            break;
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
        switch (ch) {
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
            this.unicode += ch;
            if (this.unicode.length === 4) {
              this.unicode = parseInt(this.unicode, 16);
              this.value += String.fromCharCode(this.unicode);
              this.unicode = '';
              this.state = 'string';
            }
            break;
          default:
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
        this.emit('null', null);
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
        this.emit('boolean', false);
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
        this.emit('boolean', true);
        this.state = 'value';
        break;
      }
    }
  }
};

Parser.prototype._reset = function() {
  this.state = 'value';
  this.value = '';
  this.unicode = '';
  this.written = 0;
  this.decode = new StringDecoder('utf8');
  this.data = null;
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
 * Object Assembler
 */

Parser.create = function(parser) {
  var parser = parser || new Parser()
    , stack = []
    , key;

  parser.on('object start', function() {
    var object = {};
    this.emit('.value', object);
    stack.push(object);
  });

  parser.on('object key', function(val) {
    key = val;
  });

  parser.on('object end', function() {
    this.emit('object', stack.pop());
  });

  parser.on('array start', function() {
    var array = [];
    this.emit('.value', array);
    stack.push(array);
  });

  parser.on('array end', function() {
    this.emit('array', stack.pop());
  });

  parser.on('number', function(val) {
    this.emit('.value', val); // , key
  });

  parser.on('string', function(val) {
    this.emit('.value', val);
  });

  parser.on('boolean', function(val) {
    this.emit('.value', val);
  });

  parser.on('.value', function(val) {
    var top = stack[stack.length-1];
    if (!top) {
      if (key) {
        return this._error('Unexpected key.');
      }
      this.data = val;
      stack.push(val);
      return;
    }
    if (!key) {
      if (!Array.isArray(top)) {
        return this._error('Expected key.');
      }
      top.push(val);
    } else {
      if (Array.isArray(top)) {
        return this._error('Unexpected key.');
      }
      top[key] = val;
      key = null;
    }
  });

  return parser;
};

/**
 * Pool
 */

var parsers = new FreeList('parsers', 20, function() {
  return Parser.create();
});

/**
 * Expose
 */

module.exports = exports = Parser.create;
exports.Parser = Parser;

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
  var parser = parsers.alloc()
    , limit = options.jsonLimit || options.limit;

  parser.on('error', function(err) {
    req.socket.destroy();
    next(err);
  });

  parser.on('end', function(data) {
    parsers.free(parser);
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
};

/**
 * Crude Test
 */

if (!module.parent) (function() {
  var assert = require('assert');
  var TEST_JSON = '{"a":{"b":100,"c":[2,3]},"d":["e"],"f":true}';

  var parser = Parser.create();

  parser.on('end', function(obj) {
    console.log(obj);
    assert.deepEqual(obj, JSON.parse(TEST_JSON), 'Not deep equal.');
    assert.equal(JSON.stringify(obj), TEST_JSON, 'Not equal.');
    console.log('Completed.');
  });

  var emit = parser.emit;
  parser.emit = function(type, val) {
    console.log(type, val);
    return emit.apply(this, arguments);
  };

  parser.write(TEST_JSON.slice(0, 25));
  parser.write(TEST_JSON.slice(25));
  parser.end();

  /*
  (function emit(a, b) {
    parser.emit(a, b);
    return emit;
  })
  ('object start')
  ('object key', 'hello')
  ('object start')
  ('object key', 'world')
  ('number', 100)
  ('object key', 'test')
  ('array start')
  ('number', 2)
  ('number', 3)
  ('array end')
  ('object end')
  ('object key', 'hi')
  ('array start')
  ('string', 'an array!')
  ('array end')
  ('object end')
  ('end', parser.data);
  */
})();

