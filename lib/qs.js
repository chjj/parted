// streaming qs parser for a more robust body parser

var EventEmitter = require('events').EventEmitter
  , StringDecoder = require('string_decoder').StringDecoder
  , qs = require('querystring');

var AMP = '&'.charCodeAt(0)
  , EQUAL = '='.charCodeAt(0);

var Parser = function(stream, func) {
  if (!(this instanceof Parser)) {
    return new Parser();
  }

  EventEmitter.call(this);

  this.out = {};
  this.state = 'IN_KEY';
  this.buff = '';
  this.decoder = new StringDecoder('utf8');

  if (stream && func) {
    this.on('end', function(data) {
      func(null, data);
    });
    stream.pipe(this);
  }
};

Parser.prototype = Object.create(EventEmitter.prototype, {
  constructor: { value: Parser }
});

Parser.prototype.write = function(data) {
  var i = 0
    , k = 0
    , l = data.length;

  for (; i < l; i++) {
    switch (this.state) {
      case 'IN_KEY':
        if (data[i] === EQUAL) {
          this.state = 'IN_VAL';
          this.buff += this.decoder.write(data.slice(0, i));
          this.key = unescape(this.buff);
          this.buff = '';
          k = i + 1;
        }
        break;
      case 'IN_VAL':
        if (data[i] === AMP) {
          this.state = 'IN_KEY';
          this.buff += this.decoder.write(data.slice(0, i));
          this.out[this.key] = unescape(this.buff);
          this.emit('data', this.key, this.out[this.key]);
          this.key = this.buff = '';
          k = i + 1;
        }
        break;
    }
  }

  if (k < data.length) {
    this.buff += this.decoder.write(data.slice(k));
  }
};

Parser.prototype.end = function(data) {
  if (data) this.write(data);
  this.emit('end', this.out);
};

var unescape = function(str) {
  try {
    return decodeURIComponent(str.replace(/\+/g, ' ')); // qs.escape
  } catch(e) {
    return str;
  }
};