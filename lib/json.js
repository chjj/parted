/**
 * Parted JSON Parser (Experimental)
 * Copyright (c) 2011, Christopher Jeffrey
 */

var EventEmitter = require('events').EventEmitter
  , StringDecoder = require('string_decoder').StringDecoder;

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

  this.writable = false;
  this.readable = false;

  if (data) this.write(data);

  if (this.value) {
    switch (this.state) {
      case 'number':
        this.emit('number', +this.value);
        break;
      case 'value':
        this.emit('string', this.value);
        break;
    }
  }

  this.emit('end', this.data);

  this._reset();

  return true;
};

Parser.prototype._parse = function(data) {
  var i = 0
    , len = data.length
    , ch;

  data = this.decode.write(data);

  for (; i < len; i++) {
    ch = data[i]; 
    switch (ch) {
      case '{':
        switch (this.state) {
          case 'value':
            this.emit('object start');
            break;
          default:
            return this._error('Unexpected `{`');
        }
        break;
      case '}':
        switch (this.state) {
          case 'number':
            this.state = 'value';
            this.emit('number', +this.value);
            this.value = '';
            this.emit('object end'); 
            break;
          case 'value':
            if (this.value) {
              this.emit('string', this.value);
              this.value = '';
            }
            this.emit('object end');
            break;
          default:
            return this._error('Unexpected `}`');
        }
        break;
      case '[':
        switch (this.state) {
          case 'value':
            this.emit('array start');
            break;
          default:
            return this._error('Unexpected `[`');
        }
        break;
      case ']':
        switch (this.state) {
          case 'number':
            this.state = 'value';
            this.emit('number', +this.value);
            this.value = '';
            this.emit('array end'); 
            break;
          case 'value':
            if (this.value) {
              this.emit('string', this.value);
              this.value = '';
            }
            this.emit('array end');
            break;
          default:
            return this._error('Unexpected `]`');
        }
        break;
      case '"':
        switch (this.state) {
          case 'value':
            this.state = 'string';
            break;
          case 'string':
            if (this._escapeNext) {
              this.value += ch;
              this._escapeNext = 0;
            } else {
              this.state = 'value';
              switch (this.state) {
                case 'value':
                  ; // nothing
                  break;
                default:
                  return this._error('Unexpected `"`');
              }
            }
            break;
          default:
            return this._error('Unexpected `"`');
        }
        break;
      case ',':
        switch (this.state) {
          case 'number':
            this.state = 'value';
            this.emit('number', +this.value);
            this.value = '';
            break;
          case 'value':
            if (this.value) {
              this.emit('string', this.value);
              this.value = '';
            }
            break;
          default:
            return this._error('Unexpected `,`');
        }
        break;
      case ':':
        switch (this.state) {
          case 'value':
            this.emit('object key', this.value);
            this.value = '';
            break;
          default:
            return this._error('Unexpected `:`');
        }
        break;
      case '\\':
        switch (this.state) {
          case 'string':
            if (this._escapeNext) {
              this.value += ch;
            } else {
              this._escapeNext = 2;
            }
            break;
          default:
            return this._error('Unexpected `\\`');
        }
        break;
      case '-':
      case '.':
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
        switch (this.state) {
          case 'unicode':
            if (ch === '.'
                || ch === '-') {
              return this._error('Unexpected `' + ch + '`');
            }
            this.unicode += ch;
            if (this.unicode.length === 4) {
              this.value += String.fromCharCode(parseInt(this.unicode, 16));
              this.unicode = '';
              this.state = 'string';
            }
            break;
          case 'value':
            if (ch === '.') {
              // json doesnt have .x numbers
              return this._error('Unexpected `.`');
            }
            this.state = 'number';
            this.value += ch;
            break;
          case 'number':
            if (ch === '-') {
              // json doesnt have expressions
              return this._error('Unexpected `-`');
            }
            this.value += ch;
            break;
          case 'string':
            this.value += ch;
            break;
          default:
            return this._error('Unexpected `' + ch + '`');
        }
        break;
      case 'u':
        if (this._escapeNext && this.state === 'string') {
          this.state = 'unicode';
          this._escapeNext = 0;
          this.unicode = '';
          break;
        }
        ; // FALL-THROUGH
      case 'f':
      case 'a':
      case 'l':
      case 's':
      case 'e':
      case 't':
      case 'r':
      case 'u':
        switch (this.state) {
          case 'value':
            this.state = 'boolean';
            this.value += ch;
            break;
          case 'boolean':
            switch (ch) {
              case 'e':
                switch (this.value) {
                  case 'true':
                    this.emit('boolean', true);
                    break;
                  case 'false':
                    this.emit('boolean', false);
                    break;
                  default:
                    return this._error('Unexpected `' + ch + '`');
                }
                this.state = 'value';
                this.value = '';
                break;
              default:
                if (this.value.length > 5) {
                  return this._error('Unexpected `' + ch + '`');
                }
                this.value += ch;
                break;
            }
            break;
          case 'string':
            this.value += ch;
            break;
          default:
            return this._error('Unexpected `' + ch + '`');
            break;
        }
        break;
      default:
        switch (this.state) {
          case 'number':
            if (ch > ' ') {
              return this._error('Unexpected `' + ch + '`');
            }
            this.state = 'value';
            this.emit('number', +this.value);
            this.value = '';
            break;
          case 'string':
            this.value += ch;
            break;
          default:
            if (ch > ' ') {
              return this._error('Unexpected `' + ch + '`');
            }
            break;
        }
        break;
    }
    if (this._escapeNext) this._escapeNext--;
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
  this._escapeNext = 0;
};

Parser.prototype._error = function(err) {
  this.destroy();
  this.emit('error', new Error(err + ''));
};

Parser.prototype.destroy = function(err) {
  this.writable = false;
  this.readable = false;
  this._reset();
};

/**
 * Object Assembler
 */

Parser.create = function() {
  var parser = new Parser()
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

module.exports = Parser;

if (!module.parent) (function() {
  var assert = require('assert');
  var TEST_JSON = '{"hello":{"world":100,"test":[2,3]},"hi":["an array!"]}';

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

  /*(function emit(a, b) {
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
  ('end', parser.data);*/
})();

