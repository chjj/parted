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

var parted = function(type, opt) {
  if (!(this instanceof parted)) {
    return new parted(type, opt);
  }

  EventEmitter.call(this);

  this.writable = true;
  this.readable = true;

  this.opt = opt || {};

  var key = grab(type, 'boundary');
  if (!key) {
    return this._error('No boundary key found.');
  }

  this.key = new Buffer('\r\n--' + key);

  this.state = 'start';
  this.pending = 0;
  this.written = 0;
  this.buff = new Buffer(200);
  this.verified = false;

  this._reset();
};

parted.prototype.__proto__ = EventEmitter.prototype;

/**
 * Parsing
 */

parted.prototype.write = function(data) {
  if (this.done) {
    // this parser assumes a message is finished 
    // after the second dash of the last boundary 
    // key. however, some browsers send another 
    // CRLF. there might be 2 extra bytes at the 
    // end that we can ignore.
    if (data.length < 3) return;
    return this._error('Message overflow.');
  }

  try {
    this.written += data.length;
    this.emit('chunk');
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

  if (!this.done) {
    return this._error('Message underflow.');
  }

  if (!this.pending) this.emit('end');

  return true;
};

parted.prototype._parse = function(data) {
  // `val` is essentially just a
  // register to throw things onto
  var i = 0
    , len = data.length
    , last = this.last
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
          case CR:
            this.pos = 1;
            this.state = 'maybe_in_key';
            break;
          case DASH:
            this.pos = 3;
            this.state = 'maybe_in_key';
            break;
          default:
            break;
        }
        break;
      case 'maybe_in_key':
        if (this.pos === key.length - 1) {
          this.state = 'in_key_end';
        } else if (ch !== key[this.pos]) {
          if (!this.verified) {
            this.state = 'start'; 
          } else {
            this.state = 'in_body';
            // need to _write the bytes missed
            val = this.pos - i;
            if (val > 0) this._write(key.slice(0, val));
          }
        } else {
          this.pos++;
        }
        break;
      case 'in_key_end':
        switch (ch) {
          case CR:
            this.state = 'in_key_line_end';
            break;
          case DASH:
            this.state = 'in_key_dash_end';
            break;
          default: 
            return this._error('Parse error 2.');
        }
        break;
      case 'in_key_line_end':
        switch (ch) {
          case LF:
            if (!this.verified) {
              this.verified = true;
            } else {
              this._finish();
            }
            this.state = 'in_header_name';
            this.pos = 0;
            break;
          default: 
            return this._error('Parse error 3.');
        }
        break;
      case 'in_key_dash_end':
        switch (ch) {
          case DASH:
            this._finish();
            this.done = true;
            return;
          default: 
            return this._error('Parse error 4.');
        }
        break;
      case 'in_header_name':
        switch (ch) {
          case COLON:
            val = buff.slice(0, this.pos);
            this.header = val.toString('ascii').toLowerCase();
            this.pos = 0;
            this.state = 'in_header_val';
            break;
          default:
            buff[this.pos++] = ch;
            break;
        }
        break;
      case 'in_header_val':
        switch (ch) {
          case CR:
            this.state = 'in_header_val_cr';
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
      case 'in_header_val_cr':
        switch (ch) {
          case LF:
            val = buff.slice(0, this.pos);
            this.headers[this.header] = val.toString('ascii');

            this.pos = 0;
            this.state = 'in_header_end';
            break;
          default: 
            return this._error('Parse error 5.');
        }
        break;
      case 'in_header_end':
        switch (ch) {
          case CR: 
            this.state = 'in_head_end_cr';
            break;
          default:
            this.state = 'in_header_name';
            buff[this.pos++] = ch;
            break;
        }
        break;
      case 'in_head_end_cr':
        switch (ch) {
          case LF:
            val = this.headers['content-disposition'];
            this.field = grab(val, 'name');
            this.file = grab(val, 'filename');

            this.state = 'in_body';

            i++; // exclude the LF.
            if (i >= len) return;

            data = data.slice(i);
            i = 0;
            len = data.length;
            break;
          default:
            return this._error('Parse error 6.');
        }
        break;
      case 'in_body':
        switch (ch) {
          case CR:
            if (i > 0) this._write(data.slice(0, i));

            this.pos = 1;
            this.state = 'maybe_in_key';

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

  if (this.state === 'in_body') { 
    this._write(data);
  }
};

parted.prototype._write = function(data) {
  if (this.file) {
    if (!this.data) this.data = stream(this.file);
    return this.data.write(data);
  } else {
    if (!this.data) this.data = '';
    this.data += this.decoder.write(data); 
    return true;
  }
};

// called on initialization, 
// also when a part finishes, 
// after events are emitted
parted.prototype._reset = function() {
  this.decoder = new StringDecoder('utf8');
  this.headers = {};
  this.pos = 0;
  this.field = null;
  this.data = null;
  this.file = null;
};

parted.prototype._error = function(err) {
  this.writable = false;
  this.readable = false;
  this.emit('error', new Error(err + ''));
};

// called when a part finishes
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

    if (self.done && !self.pending) {
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

parted.middleware = function(opt) {
  opt = opt || {};
  opt.limit = opt.limit || Infinity;
  return function(req, res, next) {
    if (req.method === 'GET'
        || req.method === 'HEAD'
        || req.body) return next();

    var type = req.headers['content-type'];

    if (type && type.indexOf('multipart/form-data') === 0) {
      var parser = new parted(type, opt)
        , parts = {};

      parser.on('error', function(err) {
        req.destroy();
        next(err);
      });

      parser.on('data', function(part) {
        parts[part.field] = part.file || part.text;
      });

      parser.on('chunk', function() {
        if (parser.written > opt.limit) {
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

var stream = function(name) {
  name = path.basename(name).substring(0, 10);
  name = path.join(parted.root, Date.now() + '_' + name);
  return fs.createWriteStream(name);
};

var grab = function(str, name) {
  if (!str) return;

  var rx = new RegExp(name + '\\s*=\\s*([^;]+)', 'i')
    , cap = rx.exec(str);

  if (cap) {
    return cap[1].trim().replace(/^['"]|['"]$/g, '');
  }
};

/**
 * Expose
 */

module.exports = parted;
