// Parted - a streaming multipart state parser
// (c) Copyright 2011, Christopher Jeffrey (//github.com/chjj) (MIT Licensed)

var fs = require('fs')
  , path = require('path')
  , EventEmitter = require('events').EventEmitter
  , StringDecoder = require('string_decoder').StringDecoder;

var DASH = '-'.charCodeAt(0)
  , CR = '\r'.charCodeAt(0)
  , LF = '\n'.charCodeAt(0)
  , COLON = ':'.charCodeAt(0)
  , SPACE = ' '.charCodeAt(0);

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

  this.state = 'START';
  this.pending = 0;
  this.last = new Buffer([0, 0, 0]);
  this.buff = new Buffer(200);

  this._reset();
};

parted.prototype.__proto__ = EventEmitter.prototype;

parted.prototype.write = function(data) {
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
    ch = data[i];
    switch (this.state) {
      case 'START':
        // check to make sure these 
        // arent the two first bytes
        if (ch === LF && last[0] === CR) {
          if (last[1] !== 0) {
            this.state = 'IN_HEADER_NAME';
          }
        }
        break;
      case 'IN_HEADER_NAME':
        if (ch === COLON) {
          val = buff.slice(0, this.pos);
          this.header = val.toString('ascii').toLowerCase();

          this.pos = 0;
          this.state = 'IN_HEADER_VAL';
        } else {
          // need this here in case someone 
          // tries to flood the server with 
          // a never-ending header name
          if (this.pos > 50) {
            return this._error('Overflow.');
          }
          buff[this.pos++] = ch;
        }
        break;
      case 'IN_HEADER_VAL':
        if (ch === LF && last[0] === CR) {
          // trim off the single leading space
          // thats usually in headers
          val = buff.slice(0, this.pos);
          if (val[0] === SPACE) {
            val = val.slice(1);
          }

          // do -1 on the slice because theres
          // no efficient way to exclude the CR
          val = val.toString('ascii').slice(0, -1);
          this.headers[this.header] = val;

          this.pos = 0;
          this.state = 'IN_HEADER_END';
        } else {
          // make sure someones not 
          // sending too much data
          if (this.pos > 200) {
            return this._error('Overflow.');
          }
          buff[this.pos++] = ch;
        }
        break;
      case 'IN_HEADER_END': 
        // buffer bytes in case 
        // were not actually at the end
        buff[this.pos++] = ch;

        if (ch === LF && last[0] === CR
            && last[1] === LF && last[2] === CR) {
          val = this.headers['content-disposition'];
          this.field = grab(val, 'name');
          this.file = grab(val, 'filename');

          this.state = 'IN_BODY';

          // the `last` buffer won't be updated 
          // here, but it shouldn't matter.
          // increment to exclude the LF.
          if (++i >= len) return true;

          data = data.slice(i);
          i = 0;
          len = data.length;
        } else {
          if ((ch !== CR && last[0] === LF)
              || (ch !== LF && last[0] === CR)) {
            this.state = 'IN_HEADER_NAME';
          }
        }
        break;
      case 'IN_BODY':
        if (ch === key[0]) {
          if (i > 0) this._write(data.slice(0, i));

          this.pos = 1;
          this.state = 'IN_BODY_END';

          data = data.slice(i); 
          i = 0; 
          len = data.length;
        }
        break;
      case 'IN_BODY_END':
        if (this.pos === key.length) {
          if (ch === LF && last[0] === CR) {
            this._finish();
            if (last[1] === DASH && last[2] === DASH) {
              // end of message
              return true;
            } else {
              // end of part
              this.state = 'IN_HEADER_NAME';
            }
          }
        } else if (ch !== key[this.pos]) {
          this.state = 'IN_BODY';
          // need to _write the bytes missed
          val = this.pos - i; 
          if (val > 0) this._write(key.slice(0, val));
        } else {
          this.pos++;
        }
        break;
    }

    // buffer the last 3 bytes
    // this is the only real buffering
    // that occurs throughout the entire
    // parser
    last[2] = last[1];
    last[1] = last[0];
    last[0] = ch;
  }

  if (this.state === 'IN_BODY') { 
    this._write(data);
  }

  return true;
};

parted.prototype.end = function(data) {
  if (!this.writable) return;

  this.writable = false;
  this.readable = false;
  this.done = true;

  if (data) this.write(data);
  if (!this.pending) this.emit('end');

  return true;
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
  this.emit('error', new Error(err));
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

// directory for uploads
parted.root = '/tmp';

parted.middleware = function(opt) {
  return function(req, res, next) {
    if (req.body) return next();

    var parts = req.body = {}
      , type = req.headers['content-type'];

    if (type && ~type.indexOf('multipart/form-data')) {
      var parser = new parted(type, opt);
      parser.on('error', function(err) {
        req.destroy();
        next(err);
      });
      parser.on('data', function(part) {
        parts[part.field] = part.file || part.text;
      });
      parser.on('end', next);
      req.pipe(parser);
    } else {
      next();
    }
  };
};

// helpers
var stream = function(name) {
  name = path.basename(name).substring(0, 10);
  name = path.join(parted.root, Date.now() + '_' + name);
  return fs.createWriteStream(name);
};

var grab = function(str, name) {
  if (!str) return;
  var $ = new RegExp(name + '\\s*=\\s*([^;]+)', 'i');
  if ($ = $.exec(str)) {
    return $[1].trim().replace(/^['"]|['"]$/g, '');
  }
};

module.exports = parted;