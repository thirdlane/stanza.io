'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

var _xmppJid = require('xmpp-jid');

exports['default'] = function (JXT) {

    var Utils = JXT.utils;

    Utils.jidAttribute = function (attr, prepped) {

        return {
            get: function get() {

                var jid = new _xmppJid.JID(Utils.getAttribute(this.xml, attr));
                if (prepped) {
                    jid.prepped = true;
                }
                return jid;
            },
            set: function set(value) {

                Utils.setAttribute(this.xml, attr, (value || '').toString());
            }
        };
    };

    Utils.jidSub = function (NS, sub, prepped) {

        return {
            get: function get() {

                var jid = new _xmppJid.JID(Utils.getSubText(this.xml, NS, sub));
                if (prepped) {
                    jid.prepped = true;
                }
                return jid;
            },
            set: function set(value) {

                Utils.setSubText(this.xml, NS, sub, (value || '').toString());
            }
        };
    };

    Utils.tzoSub = Utils.field(function (xml, NS, sub, defaultVal) {

        var hrs = undefined,
            min = undefined,
            split = undefined;
        var sign = -1;
        var formatted = Utils.getSubText(xml, NS, sub);

        if (!formatted) {
            return defaultVal;
        }

        if (formatted.charAt(0) === '-') {
            sign = 1;
            formatted = formatted.slice(1);
        }

        split = formatted.split(':');
        hrs = parseInt(split[0], 10);
        min = parseInt(split[1], 10);
        return (hrs * 60 + min) * sign;
    }, function (xml, NS, sub, value) {

        var hrs = undefined,
            min = undefined;
        var formatted = '-';
        if (typeof value === 'number') {
            if (value < 0) {
                value = -value;
                formatted = '+';
            }
            hrs = value / 60;
            min = value % 60;
            formatted += (hrs < 10 ? '0' : '') + hrs + ':' + (min < 10 ? '0' : '') + min;
        } else {
            formatted = value;
        }
        Utils.setSubText(xml, NS, sub, formatted);
    });
};

module.exports = exports['default'];
//# sourceMappingURL=types.js.map