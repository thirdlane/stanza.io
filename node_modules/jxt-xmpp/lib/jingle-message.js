'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

var _xmppConstants = require('xmpp-constants');

exports['default'] = function (JXT) {

    var Utils = JXT.utils;

    var Propose = JXT.define({
        name: 'jingleProposeSession',
        namespace: _xmppConstants.Namespace.JINGLE_MESSAGE_0,
        element: 'propose',
        fields: {
            id: Utils.attribute('id'),
            applications: {
                get: function get() {
                    var results = [];

                    var descs = JXT.tagged('jingle-description');
                    var lookup = {};

                    descs.forEach(function (Desc) {
                        lookup[Desc.prototype._NS] = Desc;
                    });

                    console.log(lookup);

                    for (var i = 0; i < this.xml.childNodes.length; i++) {
                        var child = this.xml.childNodes[i];

                        if (child.localName !== 'description') {
                            continue;
                        }

                        if (lookup[child.namespaceURI]) {
                            results.push(new Desc(null, child, this));
                        }
                    }

                    return results;
                },
                set: function set(applications) {

                    var self = this;
                    var descs = JXT.tagged('jingle-description');
                    var lookup = {};

                    descs.forEach(function (Desc) {
                        lookup[Desc.prototype._name] = Desc;
                    });

                    console.log(lookup);

                    for (var i = 0, len = this.xml.childNodes.length; i < len; i++) {
                        this.xml.removeChild(this.xml.childNodes[i]);
                    }

                    applications.forEach(function (app) {

                        if (!app.descType) {
                            return;
                        }

                        var Desc = lookup['_' + app.descType];
                        if (!Desc) {
                            return;
                        }

                        var child = new Desc(app);

                        self.xml.appendChild(child.xml);
                    });
                }
            }
        }
    });

    JXT.withMessage(function (Message) {

        JXT.extend(Message, Propose);
        JXT.add(Message, 'jingleRetractSession', Utils.subAttribute(_xmppConstants.Namespace.JINGLE_MESSAGE_0, 'retract', 'id'));
        JXT.add(Message, 'jingleAcceptSession', Utils.subAttribute(_xmppConstants.Namespace.JINGLE_MESSAGE_0, 'accept', 'id'));
        JXT.add(Message, 'jingleRejectSession', Utils.subAttribute(_xmppConstants.Namespace.JINGLE_MESSAGE_0, 'reject', 'id'));
        JXT.add(Message, 'jingleStartSession', Utils.subAttribute(_xmppConstants.Namespace.JINGLE_MESSAGE_0, 'proceed', 'id'));
    });
};

module.exports = exports['default'];
//# sourceMappingURL=jingle-message.js.map