/**
 * Streaming QS Parser
 */

var EventEmitter = require('events').EventEmitter
  , StringDecoder = require('string_decoder').StringDecoder;

var AMP = '&'.charCodeAt(0)
  , EQUAL = '='.charCodeAt(0);

/**
 * Parser
 */

var Parser = function() {
  if (!(this instanceof Parser)) {
    return new Parser();
  }

  EventEmitter.call(this);

  this.state = 'key';
  this.buff = '';
  this.decode = new StringDecoder('utf8');
};

Parser.prototype.__proto__ = EventEmitter.prototype;

Parser.prototype.write = function(data) {
  var i = 0
    , k = 0
    , l = data.length
    , ch;

  for (; i < l; i++) {
    ch = data[i];
    switch (this.state) {
      case 'key':
        switch (ch) {
          case EQUAL:
            this.state = 'value';
            this.buff += this.decode.write(data.slice(0, i));
            this.key = unescape(this.buff);
            this.buff = '';
            k = i + 1;
            break;
          case AMP:
            return this._error('Unexpected AMP.');
          default:
            break;
        }
        break;
      case 'value':
        switch (ch) {
          case AMP:
            this.state = 'key';
            this.buff += this.decode.write(data.slice(0, i));
            this.emit('value', this.key, unescape(this.buff));
            this.key = '';
            this.buff = '';
            k = i + 1;
            break;
          case EQUAL:
            return this._error('Unexpected EQUAL.');
          default:
            break;
        }
        break;
    }
  }

  if (k < data.length) {
    this.buff += this.decode.write(data.slice(k));
  }
};

Parser.prototype.end = function(data) {
  if (data) this.write(data);
  this.emit('end');
};

Parser.prototype._error = function(err) {
  this.destroy();
  this.emit('error', new Error(err + ''));
};

Parser.prototype.destroy = function(err) {
  this.writable = false;
  this.readable = false;
};

var unescape = function(str) {
  try {
    str = decodeURIComponent(str.replace(/\+/g, ' ')); 
  } catch(e) {
    return str.replace(/\0/g, '');
  }
};

/**
 * Expose
 */

module.exports = Parser;
