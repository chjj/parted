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

  if (!this.pending) this.emit('end');

  return true;
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
            if (val > 0) this._write(key.slice(0, val));
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
            return this._error('Parse error 1.');
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
            return this._error('Parse error 2.');
        }
        break;
      case 'key_dash_end':
        switch (ch) {
          case DASH:
            this._finish();
            this.epilogue = true;
            return;
          default: 
            return this._error('Parse error 3.');
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
            val = buff.slice(0, this.pos);
            this.headers[this.header] = val.toString('ascii');

            this.pos = 0;
            this.state = 'header_end';
            break;
          default: 
            return this._error('Parse error 4.');
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
            val = this.headers['content-disposition'];
            this.field = grab(val, 'name');
            this.file = grab(val, 'filename');

            this.state = 'body';

            i++; // exclude LF
            if (i >= len) return;

            data = data.slice(i);
            i = 0;
            len = data.length;
            break;
          default:
            return this._error('Parse error 5.');
        }
        break;
      case 'body':
        switch (ch) {
          case CR:
            if (i > 0) this._write(data.slice(0, i));

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

parted.prototype._write = function(data) {
  this.written += data.length;
  this.emit('chunk', data.length, this.written);

  if (this.file) {
    if (!this.data) {
      this.data = stream(this.file, this.options.path);
    }
    return this.data.write(data);
  } else {
    if (!this.data) this.data = '';
    this.data += this.decoder.write(data); 
    return true;
  }
};

parted.prototype._reset = function() {
  this.decoder = new StringDecoder('utf8');
  this.headers = {};
  this.pos = 0;
  this.field = null;
  this.data = null;
  this.file = null;
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
    , headers = this.headers
    , data = this.data
    , part;

  this.pending++;

  part = {
    field: field,
    type: headers['content-type'],
    encoding: headers['content-encoding']
  };

  if (data.path) {
    part.file = data.path;
    data.end(next);
  } else {
    part.text = data;
    next();
  }

  this._reset();

  function next() {
    self.pending--;

    self.emit('data', part);

    if (self.epilogue && !self.pending) {
      self.emit('end');
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

      parser.on('data', function(part) {
        parts[part.field] = part.file || part.text;
      });

      parser.on('chunk', function(bytes, written) {
        if (written > options.limit) {
          parser.emit('error', new Error('Overflow.'));
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
  name = path.basename(name).substring(0, 10);
  name = path.join(dir || parted.root, Date.now() + '_' + name);
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
