# SASL : DIGEST-MD5

[![Build Status](https://travis-ci.org/otalk/xmpp-uri.png)](https://travis-ci.org/otalk/xmpp-uri)
[![Dependency Status](https://david-dm.org/otalk/xmpp-uri.png)](https://david-dm.org/otalk/xmpp-uri)
[![devDependency Status](https://david-dm.org/otalk/xmpp-uri/dev-status.png)](https://david-dm.org/otalk/xmpp-uri#info=devDependencies)

[![Browser Support](https://ci.testling.com/otalk/xmpp-uri.png)](https://ci.testling.com/otalk/xmpp-uri)



This module is a JavaScript implementation of the DIGEST-MD5 SASL mechanism,
which plugs into the [SASL](https://github.com/jaredhanson/js-sasl) framework.

## Installing

```sh
$ npm install alt-sasl-digest-md5
```

## Usage

Register the DIGEST-MD5 mechanism.

```javascript
factory.use(require('alt-sasl-digest-md5'));
```

Send an authentication response with necessary credentials.

```
var mech = factory.create(['DIGEST-MD5']);
var resp = mech.challenge('realm="elwood.innosoft.com",nonce="OA6MG9tEQGm2hh",qop="auth",algorithm=md5-sess,charset=utf-8')
               .response({ username: 'chris', password: 'secret', host: 'elwood.innosoft.com', serviceType: 'imap' });
```

## Credits

  - [Lance Stout](http://github.com/legastero)
  - [Jared Hanson](http://github.com/jaredhanson)

## License

[The MIT License](http://opensource.org/licenses/MIT)

Copyright (c) 2014 Lance Stout <[http://github.com/legasteros/](http://github.com/legastero/)>
Copyright (c) 2012 Jared Hanson <[http://jaredhanson.net/](http://jaredhanson.net/)>
