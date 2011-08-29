var parted = require('../')
  , assert = require('assert')
  , fs = require('fs')
  , path = require('path');

var files = path.normalize(__dirname + '/tmp')
  , image = fs.readFileSync(__dirname + '/top.png');

try {
  fs.readdirSync(files).forEach(function(f) {
    fs.unlink(files + '/' + f);
  });
} catch(e) {
  fs.mkdirSync(files);
}

parted.root = files;

// create a mock request
var request = function(size, file) {
  file = __dirname + '/' + file + '.part';
  var stream = fs.createReadStream(file, { 
    bufferSize: size 
  });
  var boundary = fs
    .readFileSync(file)
    .toString('utf8')
    .match(/--[^\r\n]+/)[0]
    .slice(2);
  return {
    headers: {
      'content-type': 'multipart/form-data; boundary="' + boundary + '"'
    },
    pipe: function(dest) {
      stream.pipe(dest);
    },
    emit: function(ev, err) {
      if (ev === 'error') this.errback && this.errback(err);
      return this;
    },
    on: function(ev, func) {
      if (ev === 'error') this.errback = func;
      return this;
    },
    destroy: function() {
      stream.destroy();
      return this;
    }
  };
};

var handle = parted.middleware();

var expect_text = {
  chrome: 'world...oh look the end'
              + ' of the part: \r\n------WebKi-just kidding',
  opera: 'oh look the end of the part:\r\n--',
  firefox: 'oh look the end of the part:\r\n--'
};

var message = function(size, file, func) {
  var req = request(size, file)
    , res = {};

  handle(req, res, function(err) {
    if (err) {
      console.log(req.body);
      throw err;
    }

    var parts = req.body;

    console.log('Buffer size:', size);
    console.log(parts);

    assert.ok(!!parts, 'No parts.');
    assert.ok(!!parts.content, 'No file path.');
    assert.ok(parts.text === 'hello', 
              'Bad text. Got: ' + parts.text);
    assert.ok(parts.hello === expect_text[file], 
              'Bad text. Got: ' + parts.hello);

    var got = fs.readFileSync(parts.content)
      , expect = image
      , i = 0
      , len = expect.length;

    assert.ok(got.length === len, 
      'Sizes not equal.' 
      + ' Expected: ' + len 
      + '. Got: ' + got.length + '.'
    );

    for (; i < len; i++) {
      assert.ok(got[i] === expect[i], 'Diff failure.');
    }

    console.log('Parts parsed successfully.');

    if (func) func();
  });
};

var multiple = function(file, func) {
  var times = 100;

  (function next(i) {
    if (!i) return done();
    message(i, file, function() {
      next(--i);
    });
  })(times);

  function done() {
    console.log('Completed %s, no errors.', file);
    if (func) func();
  }
};

multiple('chrome', function() {
  multiple('opera', function() {
    multiple('firefox', function() {
      console.log('DONE');
    });
  });
});
