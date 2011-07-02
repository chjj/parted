// a streaming multipart state parser
// minimal buffering (only 3 bytes)
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

var Parser = function(src, done, opt) {
  var self = this;
  if (!(this instanceof Parser)) {
    return new Parser(src, done, opt);
  }

  EventEmitter.call(this);

  this.writable = true;
  this.readable = true;

  this.on('pipe', function(source) {
    if (!src) src = source;
    var key = grab(src.headers['content-type'], 'boundary');
    if (key) {
      this.key = new Buffer('\r\n--' + key);
      this.source = src;
      src.parts = src.body = this.parts;
      if (done) this.on('end', done);
    } else {
      this._error('No boundary key found.');
    }
  });

  this.opt = opt || {};

  this.state = 'START';
  this.parts = {};
  this.pending = 0;
  this.last = [0, 0, 0];

  this._init();

  if (src) src.pipe(this);
};

Parser.root = '/tmp';

var stream = function(name) {
  name = path.basename(name);
  name = path.join(
    Parser.root, Date.now() + '_'
    + name.slice(0, 10)
  );
  return fs.createWriteStream(name);
};

Parser.prototype = Object.create(EventEmitter.prototype, {
  constructor: { value: Parser }
});

Parser.prototype._error = function(err) {
  err = new Error(err);
  this.emit('error', err);
  if (!this.source) return this.end();
  if (this.source.socket
      && this.source.socket.readable
      || this.source.readable) this.source.destroy();
};

Parser.prototype.end = function(data) {
  if (!this.writable) return;
  this.writable = false;
  this.readable = false;
  this.done = true;
  if (data) this.write(data);
  if (!this.pending) this.emit('end', this.parts);
  return true;
};

Parser.prototype.write = function(data) {
  var self = this
    , i = 0
    , l = data.length
    , last = this.last
    , key = this.key
    , ch;

  // might not need
  var ret = function() {
    last.unshift(ch);
    last.pop();
    return true;
  };

  for (; i < l; i++) {
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
          this.state = 'IN_HEADER_VAL';
          this.hname = this.hname.toLowerCase();
        } else {
          // need this here in case someone 
          // tries to flood the server with 
          // a never-ending header name
          if (this.hname.length > 50) {
            return this._error('Overflow.');
          }
          this.hname += String.fromCharCode(ch);
        }
        break;
      case 'IN_HEADER_VAL':
        if (ch === LF && last[0] === CR) {
          // trim off the single leading space
          // thats usually in headers
          // do -1 on the slice because theres
          // no efficient way to exclude the CR
          if (this.hval[0] === SPACE) {
            this.hval = this.hval.slice(1);
          }
          this.headers[this.hname] = this.hval.slice(0, -1);
          this.hname = this.hval = '';
          this.state = 'IN_HEADER_END';
        } else {
          // make sure someones not 
          // sending too much data
          if (this.hval.length > 200) {
            return this._error('Overflow.');
          }
          this.hval += String.fromCharCode(ch);
        }
        break;
      case 'IN_HEADER_END': 
        // buffer bytes in case 
        // were not actually at the end
        this.hname += String.fromCharCode(ch);
        if (ch === LF && last[0] === CR
            && last[1] === LF && last[2] === CR) {
          //this.type = this.headers['content-type'];
          //this.encoding = this.headers['content-encoding'];
          this.name = grab(this.headers['content-disposition'], 'name');
          this.file = grab(this.headers['content-disposition'], 'filename');

          this.state = 'IN_BODY';
          this.hname = '';

          if (i + 1 >= l) return ret();
          data = data.slice(i + 1), i = 0, l = data.length;
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
          data = data.slice(i), i = 0, l = data.length;
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
          var diff = this.pos - i; 
          if (diff > 0) this._write(key.slice(0, diff));
        } else {
          this.pos++;
        }
        break;
    }

    // buffer the last 3 bytes
    // this is the only real buffering
    // that occurs throughout the entire
    // parser
    last.unshift(ch);
    last.pop();
  }

  if (self.state === 'IN_BODY') { 
    self._write(data);
  }

  return true;
};

Parser.prototype._write = function(data) {
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
Parser.prototype._init = function() {
  this.decoder = new StringDecoder('utf8');
  this.headers = {};
  this.hname = '';
  this.hval = '';
  this.pos = 0;
};

// called when a part finishes
Parser.prototype._finish = function() {
  var self = this
    , parts = this.parts
    , part;

  this.pending++;

  //debug('pending:', this.pending);
  //debug('file:', this.file);
  //debug('name:', this.name);
  //debug('headers:\n', this.headers);

  if (this.data.path) {
    parts[this.name] = part = this.data.path;
    this._init();
    this.data.end(next);
  } else {
    parts[this.name] = part = this.data;
    this._init();
    next();
  }

  this.name = null;
  this.data = null;
  this.file = null;

  function next() {
    self.pending--;

    self.emit('data', part);

    if (self.done && !self.pending) {
      self.emit('end', parts);
    }
  }
};

var grab = function(str, name) {
  if (!str) return;
  var $ = new RegExp(name + '\\s*=\\s*([^;]+)', 'i');
  if ($ = $.exec(str)) {
    return $[1].trim().replace(/^['"]|['"]$/g, '');
  }
};

Parser.middleware = function() {
  return function(req, res, next) {
    var type = req.headers['content-type'];
    if (type && ~type.indexOf('multipart/form-data')) {
      Parser(req, function(parts) {
        req.body = parts;
        next();
      });
    } else {
      next();
    }
  };
};

module.exports = Parser;