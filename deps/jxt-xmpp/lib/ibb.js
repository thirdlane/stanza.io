'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
var NS = 'http://jabber.org/protocol/ibb';

exports['default'] = function (JXT) {

    var Utils = JXT.utils;

    var IBB = {
        get: function get() {

            var data = Utils.find(this.xml, NS, 'data');
            if (data.length) {
                data = data[0];
                return {
                    action: 'data',
                    sid: Utils.getAttribute(data, 'sid'),
                    seq: parseInt(Utils.getAttribute(data, 'seq') || '0', 10),
                    data: new Buffer(Utils.getText(data), 'base64')
                };
            }

            var open = Utils.find(this.xml, NS, 'open');
            if (open.length) {
                open = open[0];
                var ack = Utils.getAttribute(open, 'stanza');
                if (ack === 'message') {
                    ack = false;
                } else {
                    ack = true;
                }

                return {
                    action: 'open',
                    sid: Utils.getAttribute(open, 'sid'),
                    blockSize: Utils.getAttribute(open, 'block-size'),
                    ack: ack
                };
            }

            var close = Utils.find(this.xml, NS, 'close');
            if (close.length) {
                return {
                    action: 'close',
                    sid: Utils.getAttribute(close[0], 'sid')
                };
            }
        },
        set: function set(value) {

            if (value.action === 'data') {
                var data = Utils.createElement(NS, 'data');
                Utils.setAttribute(data, 'sid', value.sid);
                Utils.setAttribute(data, 'seq', value.seq.toString());
                Utils.setText(data, value.data.toString('base64'));
                this.xml.appendChild(data);
            }

            if (value.action === 'open') {
                var _open = Utils.createElement(NS, 'open');
                Utils.setAttribute(_open, 'sid', value.sid);
                Utils.setAttribute(_open, 'block-size', (value.blockSize || '4096').toString());
                if (value.ack === false) {
                    Utils.setAttribute(_open, 'stanza', 'message');
                } else {
                    Utils.setAttribute(_open, 'stanza', 'iq');
                }
                this.xml.appendChild(_open);
            }

            if (value.action === 'close') {
                var _close = Utils.createElement(NS, 'close');
                Utils.setAttribute(_close, 'sid', value.sid);
                this.xml.appendChild(_close);
            }
        }
    };

    JXT.withIQ(function (IQ) {

        JXT.add(IQ, 'ibb', IBB);
    });

    JXT.withMessage(function (Message) {

        JXT.add(Message, 'ibb', IBB);
    });
};

module.exports = exports['default'];
//# sourceMappingURL=ibb.js.map