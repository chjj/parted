/**
 * Parted (https://github.com/chjj/parted)
 * A streaming multipart state parser.
 * Copyright (c) 2011, Christopher Jeffrey. (MIT Licensed)
 */

var fs = require('fs')
  , path = require('path')
  , EventEmitter = require('events').EventEmitter
  , StringDecoder = require('string_decoder').StringDecoder;

var DASH = '-'.charCodeAt(0)
  , CR = '\r'.charCodeAt(0)
  , LF = '\n'.charCodeAt(0)
  , COLON = ':'.charCodeAt(0)
  , SPACE = ' '.charCodeAt(0);

/**
 * Parted
 */

var parted = function(type, options) {
  if (!(this instanceof parted)) {
    return new parted(type, options);
  }

  EventEmitter.call(this);

  this.writable = true;
  this.readable = true;

  this.options = options || {};

  var key = grab(type, 'boundary');
  if (!key) {
    return this._error('No boundary key found.');
  }

  this.key = new Buffer('\r\n--' + key);

  this.state = 'start';
  this.pending = 0;
  this.written = 0;
  this.buff = new Buffer(200);

  this.preamble = true;
  this.epilogue = false;

  this._reset();
};

parted.prototype.__proto__ = EventEmitter.prototype;

/**
 * Parsing
 */

parted.prototype.write = function(data) {
  if (!this.writable
      || this.epilogue) return;

  try {
    this._parse(data);
  } catch(e) {
    this._error(e);
  }

  return true;
};

parted.prototype.end = function(data) {
  if (!this.writable) return;

  this.writable = false;
  this.readable = false;

  if (data) this.write(data);

  if (!this.epilogue) {
    return this._error('Message underflow.');
  }

  if (!this.pending) this._end();

  return true;
};

parted.prototype._end = function() {
  if (this.done) return;
  this.done = true;
  this.emit('end');
};

parted.prototype._parse = function(data) {
  var i = 0
    , len = data.length
    , buff = this.buff
    , key = this.key
    , ch
    , val;

  for (; i < len; i++) {
    if (this.pos >= 200) {
      return this._error('Potential buffer overflow.');
    }

    ch = data[i];

    switch (this.state) {
      case 'start': 
        switch (ch) {
          case DASH:
            this.pos = 3;
            this.state = 'key';
            break;
          default:
            break;
        }
        break;
      case 'key':
        if (this.pos === key.length) {
          this.state = 'key_end';
          i--;
        } else if (ch !== key[this.pos]) {
          if (this.preamble) {
            this.state = 'start'; 
          } else {
            this.state = 'body';
            val = this.pos - i;
            if (val > 0) {
              this._write(key.slice(0, val));
            }
            i--;
          }
        } else {
          this.pos++;
        }
        break;
      case 'key_end':
        switch (ch) {
          case CR:
            this.state = 'key_line_end';
            break;
          case DASH:
            this.state = 'key_dash_end';
            break;
          default: 
            return this._error('Expected CR or DASH.');
        }
        break;
      case 'key_line_end':
        switch (ch) {
          case LF:
            if (this.preamble) {
              this.preamble = false;
            } else {
              this._finish();
            }
            this.state = 'header_name';
            this.pos = 0;
            break;
          default: 
            return this._error('Expected CR.');
        }
        break;
      case 'key_dash_end':
        switch (ch) {
          case DASH:
            this._finish();
            this.epilogue = true;
            return;
          default: 
            return this._error('Expected DASH.');
        }
        break;
      case 'header_name':
        switch (ch) {
          case COLON:
            val = buff.slice(0, this.pos);
            this.header = val.toString('ascii');
            this.pos = 0;
            this.state = 'header_val';
            break;
          default:
            buff[this.pos++] = ch | 32;
            break;
        }
        break;
      case 'header_val':
        switch (ch) {
          case CR:
            this.state = 'header_val_end';
            break;
          case SPACE:
            if (this.pos === 0) {
              break;
            }
            ; // FALL-THROUGH
          default:
            buff[this.pos++] = ch;
            break;
        }
        break;
      case 'header_val_end':
        switch (ch) {
          case LF:
            val = buff.slice(0, this.pos).toString('ascii');
            this._disposition(this.header, val);
            this.emit('header', this.header, val);
            this.pos = 0;
            this.state = 'header_end';
            break;
          default: 
            return this._error('Expected LF.');
        }
        break;
      case 'header_end':
        switch (ch) {
          case CR: 
            this.state = 'head_end';
            break;
          default:
            this.state = 'header_name';
            i--;
            break;
        }
        break;
      case 'head_end':
        switch (ch) {
          case LF:
            this.state = 'body';
            i++; 
            if (i >= len) return;
            data = data.slice(i);
            i = 0;
            len = data.length;
            break;
          default:
            return this._error('Expected LF.');
        }
        break;
      case 'body':
        switch (ch) {
          case CR:
            if (i > 0) {
              this._write(data.slice(0, i));
            }
            this.pos = 1;
            this.state = 'key';
            data = data.slice(i); 
            i = 0; 
            len = data.length;
            break;
          default:
            break;
        }
        break;
    }
  }

  if (this.state === 'body') { 
    this._write(data);
  }
};

parted.prototype._disposition = function(name, val) {
  if (name !== 'content-disposition') return;

  this.field = grab(val, 'name');
  this.file = grab(val, 'filename');

  if (this.file) {
    this.data = stream(this.file, this.options.path);
  } else {
    this.decode = new StringDecoder('utf8');
    this.data = '';
  }
};

parted.prototype._write = function(data) {
  if (this.data == null) {
    return this._error('No disposition.');
  }

  if (this.file) {
    this.data.write(data);
  } else {
    this.data += this.decode.write(data); 
  }

  this.written += data.length;
  this.emit('data', data.length);
};

parted.prototype._reset = function() {
  this.pos = 0;
  this.decode = null;
  this.field = null;
  this.data = null;
  this.file = null;
  this.header = null;
};

parted.prototype._error = function(err) {
  this.destroy();
  this.emit('error', new Error(err + ''));
};

parted.prototype.destroy = function(err) {
  this.writable = false;
  this.readable = false;
  this._reset();
};

parted.prototype._finish = function() {
  var self = this
    , field = this.field
    , data = this.data
    , part;

  this.pending++;

  if (data.path) {
    part = data.path;
    data.end(next);
  } else {
    part = data;
    next();
  }

  this._reset();

  function next() {
    self.pending--;

    self.emit('part', field, part);

    if (self.epilogue && !self.pending) {
      self._end();
    }
  }
};

/**
 * Uploads
 */

parted.root = '/tmp';

/**
 * Middleware
 */

parted.middleware = function(options) {
  options = options || {};
  options.limit = options.limit || Infinity;
  return function(req, res, next) {
    if (req.method === 'GET'
        || req.method === 'HEAD'
        || req.body) return next();

    var type = req.headers['content-type'];

    if (type && type.indexOf('multipart/form-data') === 0) {
      var parser = new parted(type, options)
        , parts = {};

      parser.on('error', function(err) {
        req.destroy();
        next(err);
      });

      parser.on('part', function(field, part) {
        parts[field] = part;
      });

      parser.on('data', function(bytes) {
        if (this.written > options.limit) {
          this.emit('error', new Error('Overflow.'));
          this.destroy();
        }
      });

      parser.on('end', next);

      req.body = parts;
      req.pipe(parser);
    } else {
      next();
    }
  };
};

/**
 * Helpers
 */

var stream = function(name, dir) {
  var ext = path.extname(name) || ''
    , name = path.basename(name, ext) || ''
    , dir = dir || parted.root;

  name = Date.now() + '_' + name.substring(0, 10);
  name = path.join(dir, name) + ext.substring(0, 6);
  name = name.replace(/\0/g, '');

  return fs.createWriteStream(name);
};

var grab = function(str, name) {
  if (!str) return;

  var rx = new RegExp(name + '\\s*=\\s*([^;,]+)', 'i')
    , cap = rx.exec(str);

  if (cap) {
    return cap[1].trim().replace(/^['"]|['"]$/g, '');
  }
};

/**
 * Expose
 */

module.exports = parted;
