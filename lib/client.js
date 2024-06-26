'use strict';

var each = require('lodash.foreach');
var extend = Object.assign;
var isArray = require('lodash.isarray');

var jxt = require('jxt');
var WildEmitter = require('wildemitter');
var util = require('util');
var BPromise = require('bluebird');
var uuid = require('uuid');
var JID = require('xmpp-jid').JID;
var StreamManagement = require('./sm');
var SASLFactory = require('saslmechanisms');


var SASL_MECHS = {
    plain: require('sasl-plain')
};


function Client(opts) {
    var self = this;

    WildEmitter.call(this);

    opts = opts || {};
    this._initConfig(opts);

    this.stanzas = jxt.getGlobalJXT();

    this.jid = new JID();
    this.JID = JID;

    this.stanzas = jxt.createRegistry();
    this.stanzas.use(require('jxt-xmpp-types'));
    this.stanzas.use(require('jxt-xmpp'));

    this.use(require('./plugins/features'));
    this.use(require('./plugins/sasl'));
    this.use(require('./plugins/smacks'));
    this.use(require('./plugins/bind'));
    this.use(require('./plugins/session'));

    this.sm = new StreamManagement(this);

    this.transports = {};

    this.use(require('./plugins/websocket'));


    this.on('stream:data', function (data) {
        var json = data.toJSON();

        if (data._name === 'iq') {
            json._xmlChildCount = 0;
            each(data.xml.childNodes, function (child) {
                if (child.nodeType === 1) {
                    json._xmlChildCount += 1;
                }
            });
        }

        self.emit(data._eventname || data._name, json);
        if (data._name === 'message' || data._name === 'presence' || data._name === 'iq') {
            self.sm.handle(json);
            self.emit('stanza', json);
        } else if (data._name === 'smAck') {
            return self.sm.process(json);
        } else if (data._name === 'smRequest') {
            return self.sm.ack();
        }

        if (json.id) {
            self.emit('id:' + json.id, json);
            self.emit(data._name + ':id:' + json.id, json);
        }
    });

    this.on('disconnected', function () {
        if (self.transport) {
            self.transport.off('*');
            delete self.transport;
        }
        self.releaseGroup('connection');
    });

    this.on('iq', function (iq) {
        var iqType = iq.type;
        var xmlChildCount = iq._xmlChildCount;
        delete iq._xmlChildCount;

        var exts = Object.keys(iq);

        if (iq.type === 'get' || iq.type === 'set') {
            // Invalid request
            if (xmlChildCount !== 1) {
                return self.sendIq(iq.errorReply({
                    error: {
                        type:      'modify',
                        condition: 'bad-request'
                    }
                }));
            }

            // Valid request, but we don't have support for the
            // payload data.
            if (!exts.length) {
                return self.sendIq(iq.errorReply({
                    error: {
                        type:      'cancel',
                        condition: 'feature-not-implemented'
                    }
                }));
            }

            var iqEvent = 'iq:' + iqType + ':' + exts[0];
            if (self.callbacks[iqEvent]) {
                self.emit(iqEvent, iq);
            } else {
                // We support the payload data, but there's
                // nothing registered to handle it.
                self.sendIq(iq.errorReply({
                    error: {
                        type:      'cancel',
                        condition: 'feature-not-implemented'
                    }
                }));
            }
        }
    });

    this.on('message', function (msg) {
        if (Object.keys(msg.$body || {}).length) {
            if (msg.type === 'chat' || msg.type === 'normal') {
                self.emit('chat', msg);
            } else if (msg.type === 'groupchat') {
                self.emit('groupchat', msg);
            }
        }
        if (msg.type === 'error') {
            self.emit('message:error', msg);
        }
    });

    this.on('presence', function (pres) {
        var presType = pres.type || 'available';
        if (presType === 'error') {
            presType = 'presence:error';
        }
        self.emit(presType, pres);
    });
}

util.inherits(Client, WildEmitter);

Object.defineProperty(Client.prototype, 'stream', {
    get: function () {
        return this.transport ? this.transport.stream : undefined;
    }
});

Client.prototype._initConfig = function (opts) {
    var self = this;
    var currConfig = this.config || {};

    this.config = extend({
        useStreamManagement: true,
        transports:          'websocket',
        sasl:                 'plain'
    }, currConfig, opts);

    // Enable SASL authentication mechanisms (and their preferred order)
    // based on user configuration.
    if (!isArray(this.config.sasl)) {
        this.config.sasl = [this.config.sasl];
    }

    this.SASLFactory = new SASLFactory();
    this.config.sasl.forEach(function (mech) {
        if (typeof mech === 'string') {
            var existingMech = SASL_MECHS[mech.toLowerCase()];
            if (existingMech) {
                self.SASLFactory.use(existingMech);
            }
        } else {
            self.SASLFactory.use(mech);
        }
    });

    this.config.jid = new JID(this.config.jid);

    if (!this.config.server) {
        this.config.server = this.config.jid.domain;
    }

    if (this.config.password) {
        this.config.credentials = this.config.credentials || {};
        this.config.credentials.password = this.config.password;
        delete this.config.password;
    }

    if (this.config.transport) {
        this.config.transports = [this.config.transport];
    }

    if (!isArray(this.config.transports)) {
        this.config.transports = [this.config.transports];
    }
};

Client.prototype.use = function (pluginInit) {
    pluginInit(this, this.stanzas, this.config);
};

Client.prototype.nextId = function () {
    return uuid.v4();
};

Client.prototype._getConfiguredCredentials = function () {
    var creds = this.config.credentials || {};
    var requestedJID = new JID(this.config.jid);

    var username = creds.username || requestedJID.local;
    var server = creds.server || requestedJID.domain;

    var defaultCreds = {
        username:    username,
        password:    this.config.password,
        server:      server,
        host:        server,
        realm:       server,
        serviceType: 'xmpp',
        serviceName: server
    };

    var result = extend(defaultCreds, creds);

    return result;
};

Client.prototype.getCredentials = function (cb) {
    return cb(null, this._getConfiguredCredentials());
};

Client.prototype.connect = function () {
    var self = this;
    if (self.transport && self.transport.connecting) {
        return
    }

    if (self.transport && self.transport.conn && self.transport.conn.readyState === 1 && self.transport.hasStream) {
        return
    }

    var trans = self.transport = new self.transports['websocket'](self.sm, self.stanzas);

    trans.on('*', function (event, data) {
        self.emit(event, data);
    });

    return trans.connect(self.config);
};

Client.prototype.disconnect = function () {
    if (this.sessionStarted) {
        this.releaseGroup('session');
        if (!this.sm.started) {
            // Only emit session:end if we had a session, and we aren't using
            // stream management to keep the session alive.
            this.emit('session:end');
        }
    }
    this.sessionStarted = false;
    this.releaseGroup('connection');
    if (this.transport) {
        this.transport.disconnect();
    } else {
        this.emit('disconnected');
    }
};

Client.prototype.send = function (data) {
    this.sm.track(data);
    if (this.transport) {
        this.transport.send(data);
    }
};

Client.prototype.sendMessage = function (data) {
    data = data || {};
    if (!data.id) {
        data.id = this.nextId();
    }

    var Message = this.stanzas.getMessage();
    var msg = new Message(data);

    this.emit('message:sent', msg.toJSON());
    this.send(msg);

    return data.id;
};

Client.prototype.sendPresence = function (data) {
    data = data || {};
    if (!data.id) {
        data.id = this.nextId();
    }
    var Presence = this.stanzas.getPresence();
    this.send(new Presence(data));

    return data.id;
};

Client.prototype.sendIq = function (data, cb) {
    var result, respEvent, allowed, dest;
    var self = this;

    data = data || {};
    if (!data.id) {
        data.id = this.nextId();
    }

    var Iq = this.stanzas.getIq();
    var iq = (!data.toJSON) ? new Iq(data) : data;

    if (data.type === 'error' || data.type === 'result') {
        this.send(iq);
        return;
    }

    dest = new JID(data.to);
    allowed = {};
    allowed[''] = true;
    allowed[dest.full] = true;
    allowed[dest.bare] = true;
    allowed[dest.domain] = true;
    allowed[self.jid.bare] = true;
    allowed[self.jid.domain] = true;

    respEvent = 'iq:id:' + data.id;
    result = new BPromise(function (resolve, reject) {
        var handler = function (res) {
            // Only process result from the correct responder
            if (!allowed[res.from.full]) {
                return;
            }

            // Only process result or error responses, if the responder
            // happened to send us a request using the same ID value at
            // the same time.
            if (res.type !== 'result' && res.type !== 'error') {
                return;
            }

            self.off(respEvent, handler);
            if (!res.error) {
                resolve(res);
            } else {
                reject(res);
            }
        };
        self.on(respEvent, 'session', handler);
    });

    this.send(iq);

    return result.timeout(self.config.timeout * 1000 || 15000)
        .catch(BPromise.TimeoutError, function () {
            throw {
                id:    data.id,
                type:  'error',
                error: {
                    condition: 'timeout'
                }
            };
        })
        .nodeify(cb);
};

Client.prototype.sendStreamError = function (data) {
    data = data || {};

    var StreamError = this.stanzas.getStreamError();
    var error = new StreamError(data);

    this.emit('stream:error', error.toJSON());
    this.send(error);
    this.disconnect();
};


module.exports = Client;
