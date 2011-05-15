// a streaming multipart state parser
// minimal buffering (only 3 bytes)
// (c) Copyright 2011, Christopher Jeffrey (//github.com/chjj) (MIT Licensed)

var _DEBUG = false;

var fs = require('fs'),
    path = require('path'),
    EventEmitter = require('events').EventEmitter,
    StringDecoder = require('string_decoder').StringDecoder;

// this should be /tmp, used for testing
var FILES = path.normalize(__dirname + '/../tmp');
if (!path.existsSync(FILES)) {
  fs.mkdirSync(FILES, 0666);
} else {
  fs.readdirSync(FILES).forEach(function(f) {
    fs.unlink(FILES + '/' + f);
  });
}

var stream = function(name) {
  name = FILES + '/' + Date.now()
        + '_' + name.split('/').pop();
  return fs.createWriteStream(name);
};

var debug = _DEBUG
  ? function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('Parted:');
    return console.log.apply(console, args);
  }
  : function() {};

var DASH = '-'.charCodeAt(0),
    CR = '\r'.charCodeAt(0),
    LF = '\n'.charCodeAt(0),
    COLON = ':'.charCodeAt(0),
    SPACE = ' '.charCodeAt(0);

var Parser = function(source, done, opt) {
  var self = this;
  if (!(this instanceof Parser)) {
    return new Parser(source, done, opt);
  }
  
  EventEmitter.call(this);
  
  this.writable = true;
  this.readable = true;
  
  this.on('pipe', function(src) {
    source = source || src;
    var key = grab(source.headers && source.headers['content-type'], 'boundary');
    if (key) {
      this.key = new Buffer('\r\n--' + key);
      this.source = source;
      source.parts = source.body = this.parts;
      if (done) this.on('end', done);
    } else {
      this._error('No boundary key found.');
    }
  });
  this.opt = opt || {};
  this.parts = {};
  this._init();
  if (source) source.pipe(this);
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
  if (data) this.write(data);
  this.emit('end', this.parts);
  return true;
};

// we can forcefully add 1 and subtract 1 from
// `start` and `end`, because that is the smallest
// a chunk could possibly be: 1 byte
Parser.prototype.write = function(data) {
  var i = 0, l = data.length, start, end;
  
  for (; i < l; i++) {
    if (_DEBUG) {
      if (this.state !== this._state) {
        debug(this._state = this.state);
      }
      if (this.headers['content-disposition'] !== this._disp) {
        this._disp = this.headers['content-disposition'];
        debug(this.headers);
      }
    }
    switch (this.state) {
      case 'START':
        // check to make sure these arent the two first bytes
        if (data[i] === LF && this.last[0] === CR) {
          if (this.last[1] !== 0) {
            this.state = 'IN_HEADER_NAME';
          }
        }
        break;
      case 'IN_HEADER_NAME':
        if (data[i] === COLON) {
          this.state = 'IN_HEADER_VAL';
          this.hname = this.hname.toLowerCase();
        } else {
          // need this here in case someone tries to flood 
          // the server with a never-ending header name
          if (this.hname.length > 40) {
            return this._error('Overflow.');
          }
          this.hname += String.fromCharCode(data[i]);
        }
        break;
      case 'IN_HEADER_VAL':
        if (data[i] === LF && this.last[0] === CR) {
          // trim off the single leading space 
          // thats usually in headers
          // do -1 on the slice because theres 
          // no efficient way to exclude the CR
          this.headers[this.hname] = this.hval.slice(0, -1).trim(); 
          this.hname = this.hval = '';
          this.state = 'END_OF_HEADER';
        } else {
          // make sure someones not sending too much data
          if (this.hval.length > 200) {
            return this._error('Overflow.');
          }
          this.hval += String.fromCharCode(data[i]);
        }
        break;
      case 'END_OF_HEADER':
        this.hname += String.fromCharCode(data[i]);
        if (data[i] === LF && this.last[0] === CR 
          && this.last[1] === LF && this.last[2] === CR) {
            this.type = this.headers['content-type'];
            this.encoding = this.headers['content-encoding'];
            this.name = grab(this.headers['content-disposition'], 'name');
            this.file = grab(this.headers['content-disposition'], 'filename');
            this.state = 'IN_BODY';
            this.hname = '';
            this.headers = {};
            start = i + 1;
        } else {
          if ((data[i] !== CR && this.last[0] === LF) 
            || (data[i] !== LF && this.last[0] === CR)) {
              this.state = 'IN_HEADER_NAME';
          } 
        }
        break;
      case 'IN_BODY':
        if (data[i] === this.key[0]) {
          this.pos = 1;
          end = i;
          this.state = 'MAYBE_IN_BODY_END';
        }
        break;
      case 'MAYBE_IN_BODY_END':
        //debug(data[i], this.key[this.pos]);
        if (this.pos === this.key.length) {
          if (data[i] === LF && this.last[0] === CR) {
            this._finish();
            if (this.last[1] === DASH && this.last[2] === DASH) {
              // end of message
              this._init();
              debug('finished parsing');
            } else {
              // end of part
              this.state = 'IN_HEADER_NAME';
            }
          }
        } else if (data[i] !== this.key[this.pos]) {
          this.state = 'IN_BODY';
          // is it a new chunk?
          if (end === undefined) { // if it is, we need to _write the bytes we missed
            var diff = this.pos - i; // might need to add 1??
            if (diff > 0) this._write(this.key.slice(0, diff));
          } else {
            // otherwise we can just erase the modified `end`
            end = undefined;
          }
        } else {
          this.pos++;
        }
        break;
    }
    // buffer the last 3 bytes 
    // this is the only real buffering 
    // that occurs throughout the entire
    // parser
    this.last.unshift(data[i]);
    this.last.pop();
  }
  
  if (this.state === 'IN_BODY' || end !== undefined) {
    if (start === undefined) start = 0;
    if (end === undefined) end = data.length;
    if (end < 1) return;
    if (start >= end) return;
    //debug(start, end);
    if (start === 0 && end === l) {
      this._write(data);
    } else {
      this._write(data.slice(start, end));
    }
  }
  return true;
};

Parser.prototype._write = function(data) {
  if (_DEBUG) {
    if (!this.data) this.data = [];
    this.data.push(data);
    return;
  }
  if (this.file) {
    if (!this.data) this.data = stream(this.file);
    this.data.write(data);
  } else {
    if (!this.data) this.data = '';
    this.data += this.decoder.write(data); //data.toString('utf-8');
  }
};

Parser.prototype._init = function() {
  this.decoder = this.decoder || new StringDecoder('utf-8');
  this.headers = this.headers || {};
  this.state = this.state || 'START';
  this.pos = this.pos || 0;
  this.last = this.last || [0, 0, 0];
  this.hname = this.hname || '';
  this.hval = this.hval || '';
};

Parser.prototype._clear = function() {
  this.decoder = new StringDecoder('utf-8');
  this.state = null;
  this.data = null;
  this.headers = {};
  this.hname = '';
  this.hval = '';
  this.pos = 0;
};

Parser.prototype._finish = function() {
  // concatenate buffers for debugging
  if (_DEBUG && this.data.length) {
    var i, l = this.data.length,
        buff, size = 0, pos = 0;
    for (i = 0; i < l; i++) {
      size += this.data[i].length;
    }
    buff = new Buffer(size);
    for (i = 0; i < l; i++) {
      this.data[i].copy(buff, pos);
      pos += this.data[i].length;
    }
    this.data = buff.toString('utf-8');
  }
  this.parts[this.name] = this.data.path || this.data;
  if (this.data.path) {
    this.data.end();
  }
  debug('file:', this.file);
  debug('name:', this.name);
  debug('headers:\n', this.headers);
  debug('data:\n', this.data);
  this.emit('data', this.parts[this.name]);
  this._clear();
};

var grab = function(str, name) {
  if (!str) return;
  var r = new RegExp(name + '\\s*=\\s*([^;]+)', 'i');
  if (r = str.match(r)) {
    return r[1].trim().replace(/^['"]|['"]$/g, '');
  }
};

module.exports = exports = Parser;

exports.middleware = function(opt) {
  if (opt.cb) {
    var cb = opt.cb;
    delete opt.cb;
  }
  return function(req, res) {
    var next = cb || res.next || res.pass;
    var type = req.headers['content-type']
    if (type && type.indexOf('multipart/form-data') !== -1) {
      Parser(req, next, opt);
    } else {
      next();
    }
  };
};
