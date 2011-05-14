var multi = require('../');

// set up a mock multipart request

var fs = require('fs');
var boundary = fs.readFileSync(__dirname + '/test.txt', 'utf-8')
                  .match(/^--[^\r\n]+/)[0].slice(2);

//console.log(boundary);
var req = {
  headers: {
    'content-type': 'multipart/form-data; boundary="' + boundary + '"'
  },
  get stream() {
    if (!this._stream) {
      this._stream = fs.createReadStream(
        __dirname + '/test.txt', 
        // if the parser is truly streaming, it should 
        // be able to process 1 byte at a time
        { bufferSize: 1 } 
      );
    }
    return this._stream;
  },
  pipe: function(dest) {
    this.stream.pipe(dest);
  },
  emit: function(ev, err) {
    if (ev === 'error') this.errback && this.errback(err);
    return this;
  },
  on: function(ev, func) {
    this.errback = func;
    return this;
  },
  destroy: function() {
    this.stream.destroy();
    return this;
  }
};

multi(req, function() {
  console.log(req.parts);
});