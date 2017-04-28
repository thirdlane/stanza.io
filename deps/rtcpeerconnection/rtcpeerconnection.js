var util = require('util');
var each = require('lodash.foreach');
var pluck = require('lodash.pluck');
var SJJ = require('sdp-jingle-json');
var WildEmitter = require('wildemitter');
var peerconn = require('traceablepeerconnection');
var adapter = require('webrtc-adapter-test');
var SdpParser = require("sdpparser");


function PeerConnection(config, constraints) {
    var self = this;
    var item;
    WildEmitter.call(this);

    config = config || {};
    config.iceServers = config.iceServers || [];

    // make sure this only gets enabled in Google Chrome
    // EXPERIMENTAL FLAG, might get removed without notice
    this.enableChromeNativeSimulcast = false;
    if (constraints && constraints.optional &&
        adapter.webrtcDetectedBrowser === 'chrome' &&
        navigator.appVersion.match(/Chromium\//) === null) {
        constraints.optional.forEach(function (constraint) {
            if (constraint.enableChromeNativeSimulcast) {
                self.enableChromeNativeSimulcast = true;
            }
        });
    }

    // EXPERIMENTAL FLAG, might get removed without notice
    this.enableMultiStreamHacks = false;
    if (constraints && constraints.optional &&
        adapter.webrtcDetectedBrowser === 'chrome') {
        constraints.optional.forEach(function (constraint) {
            if (constraint.enableMultiStreamHacks) {
                self.enableMultiStreamHacks = true;
            }
        });
    }
    // EXPERIMENTAL FLAG, might get removed without notice
    this.restrictBandwidth = 0;
    if (constraints && constraints.optional) {
        constraints.optional.forEach(function (constraint) {
            if (constraint.andyetRestrictBandwidth) {
                self.restrictBandwidth = constraint.andyetRestrictBandwidth;
            }
        });
    }

    // EXPERIMENTAL FLAG, might get removed without notice
    // bundle up ice candidates, only works for jingle mode
    // number > 0 is the delay to wait for additional candidates
    // ~20ms seems good
    this.batchIceCandidates = 0;
    if (constraints && constraints.optional) {
        constraints.optional.forEach(function (constraint) {
            if (constraint.andyetBatchIce) {
                self.batchIceCandidates = constraint.andyetBatchIce;
            }
        });
    }
    this.batchedIceCandidates = [];

    // EXPERIMENTAL FLAG, might get removed without notice
    // this attemps to strip out candidates with an already known foundation
    // and type -- i.e. those which are gathered via the same TURN server
    // but different transports (TURN udp, tcp and tls respectively)
    if (constraints && constraints.optional && adapter.webrtcDetectedBrowser === 'chrome') {
        constraints.optional.forEach(function (constraint) {
            if (constraint.andyetFasterICE) {
                self.eliminateDuplicateCandidates = constraint.andyetFasterICE;
            }
        });
    }
    // EXPERIMENTAL FLAG, might get removed without notice
    // when using a server such as the jitsi videobridge we don't need to signal
    // our candidates
    if (constraints && constraints.optional) {
        constraints.optional.forEach(function (constraint) {
            if (constraint.andyetDontSignalCandidates) {
                self.dontSignalCandidates = constraint.andyetDontSignalCandidates;
            }
        });
    }


    // EXPERIMENTAL FLAG, might get removed without notice
    this.assumeSetLocalSuccess = false;
    if (constraints && constraints.optional) {
        constraints.optional.forEach(function (constraint) {
            if (constraint.andyetAssumeSetLocalSuccess) {
                self.assumeSetLocalSuccess = constraint.andyetAssumeSetLocalSuccess;
            }
        });
    }

    // EXPERIMENTAL FLAG, might get removed without notice
    // working around https://bugzilla.mozilla.org/show_bug.cgi?id=1087551
    // pass in a timeout for this
    if (adapter.webrtcDetectedBrowser === 'firefox') {
        if (constraints && constraints.optional) {
            this.wtFirefox = 0;
            constraints.optional.forEach(function (constraint) {
                if (constraint.andyetFirefoxMakesMeSad) {
                    self.wtFirefox = constraint.andyetFirefoxMakesMeSad;
                    if (this.wtFirefox > 0) {
                        this.firefoxcandidatebuffer = [];
                    }
                }
            });
        }
    }


    this.pc = new peerconn(config, constraints);

    this.getLocalStreams = this.pc.getLocalStreams.bind(this.pc);
    this.getRemoteStreams = this.pc.getRemoteStreams.bind(this.pc);
    this.addStream = this.pc.addStream.bind(this.pc);
    this.removeStream = this.pc.removeStream.bind(this.pc);
    if(this.pc.removeTrack) {
        this.removeTrack = this.pc.removeTrack.bind(this.pc);
    }
    if(this.pc.removeTrack) {
        this.getSenders = this.pc.getSenders.bind(this.pc);
    }

    // proxy events
    this.pc.on('*', function () {
        self.emit.apply(self, arguments);
    });

    // proxy some events directly
    this.pc.onremovestream = this.emit.bind(this, 'removeStream');
    this.pc.onaddstream = this.emit.bind(this, 'addStream');
    this.pc.onnegotiationneeded = this.emit.bind(this, 'negotiationNeeded');
    this.pc.oniceconnectionstatechange = this.emit.bind(this, 'iceConnectionStateChange');
    this.pc.onsignalingstatechange = this.emit.bind(this, 'signalingStateChange');

    // handle ice candidate and data channel events
    this.pc.onicecandidate = this._onIce.bind(this);
    this.pc.ondatachannel = this._onDataChannel.bind(this);

    this.localDescription = {
        contents: []
    };
    this.remoteDescription = {
        contents: []
    };

    this.config = {
        debug: false,
        ice: {},
        sid: '',
        isInitiator: true,
        sdpSessionID: Date.now(),
        useJingle: false
    };

    // apply our config
    for (item in config) {
        this.config[item] = config[item];
    }

    if (this.config.debug) {
        this.on('*', function () {
            var logger = config.logger || console;
            logger.log('PeerConnection event:', arguments);
        });
    }
    this.hadLocalStunCandidate = false;
    this.hadRemoteStunCandidate = false;
    this.hadLocalRelayCandidate = false;
    this.hadRemoteRelayCandidate = false;

    this.hadLocalIPv6Candidate = false;
    this.hadRemoteIPv6Candidate = false;

    // keeping references for all our data channels
    // so they dont get garbage collected
    // can be removed once the following bugs have been fixed
    // https://crbug.com/405545
    // https://bugzilla.mozilla.org/show_bug.cgi?id=964092
    // to be filed for opera
    this._remoteDataChannels = [];
    this._localDataChannels = [];

    this._candidateBuffer = [];
}

util.inherits(PeerConnection, WildEmitter);

Object.defineProperty(PeerConnection.prototype, 'signalingState', {
    get: function () {
        return this.pc.signalingState;
    }
});
Object.defineProperty(PeerConnection.prototype, 'iceConnectionState', {
    get: function () {
        return this.pc.iceConnectionState;
    }
});

PeerConnection.prototype._role = function () {
    return this.isInitiator ? 'initiator' : 'responder';
};

// Add a stream to the peer connection object
PeerConnection.prototype.addStream = function (stream) {
    this.localStream = stream;
    this.pc.addStream(stream);
};

// helper function to check if a remote candidate is a stun/relay
// candidate or an ipv6 candidate
PeerConnection.prototype._checkLocalCandidate = function (candidate) {
    var cand = SJJ.toCandidateJSON(candidate);
    if (cand.type == 'srflx') {
        this.hadLocalStunCandidate = true;
    } else if (cand.type == 'relay') {
        this.hadLocalRelayCandidate = true;
    }
    if (cand.ip.indexOf(':') != -1) {
        this.hadLocalIPv6Candidate = true;
    }
};

// helper function to check if a remote candidate is a stun/relay
// candidate or an ipv6 candidate
PeerConnection.prototype._checkRemoteCandidate = function (candidate) {
    var cand = SJJ.toCandidateJSON(candidate);
    if (cand.type == 'srflx') {
        this.hadRemoteStunCandidate = true;
    } else if (cand.type == 'relay') {
        this.hadRemoteRelayCandidate = true;
    }
    if (cand.ip.indexOf(':') != -1) {
        this.hadRemoteIPv6Candidate = true;
    }
};


// Init and add ice candidate object with correct constructor
PeerConnection.prototype.processIce = function (update, cb) {
    cb = cb || function () {};
    var self = this;

    // ignore any added ice candidates to avoid errors. why does the
    // spec not do this?
    if (this.pc.signalingState === 'closed') return cb();

    if (update.contents || (update.jingle && update.jingle.contents)) {
        var contentNames = pluck(this.remoteDescription.contents, 'name');
        var contents = update.contents || update.jingle.contents;
        contents.forEach(function (content) {
            if(adapter.webrtcDetectedBrowser === 'chrome') {
                if (content.name === 'sdparta_0') {
                    content.name = 'audio'
                }
                if (content.name === 'sdparta_1') {
                    content.name = 'video'
                }
            }
            var transport = content.transport || {};
            var candidates = transport.candidates || [];
            var mline = contentNames.indexOf(content.name);
            if (navigator.mozGetUserMedia && self.isInitiator){
                if (content.name === 'audio') {
                    content.name = 'sdparta_0'
                }
                if (content.name === 'video') {
                    content.name = 'sdparta_1'
                }
            }
            var mid = content.name;

            candidates.forEach(
                function (candidate) {
                    var iceCandidate = SJJ.toCandidateSDP(candidate) + '\r\n';
                    self.pc.addIceCandidate(
                        new RTCIceCandidate({
                            candidate: iceCandidate,
                            sdpMLineIndex: mline,
                            sdpMid: mid
                        }), function () {
                            // well, this success callback is pretty meaningless
                        },
                        function (err) {
                            self.emit('error', err);
                        }
                    );
                    self._checkRemoteCandidate(iceCandidate);
                });
        });
    } else {
        // working around https://code.google.com/p/webrtc/issues/detail?id=3669
        if (update.candidate && update.candidate.candidate.indexOf('a=') !== 0) {
            update.candidate.candidate = 'a=' + update.candidate.candidate;
        }

        if (this.wtFirefox && this.firefoxcandidatebuffer !== null) {
            // we cant add this yet due to https://bugzilla.mozilla.org/show_bug.cgi?id=1087551
            if (this.pc.localDescription && this.pc.localDescription.type === 'offer') {
                this.firefoxcandidatebuffer.push(update.candidate);
                return cb();
            }
        }

        self.pc.addIceCandidate(
            new RTCIceCandidate(update.candidate),
            function () { },
            function (err) {
                self.emit('error', err);
            }
        );
        self._checkRemoteCandidate(update.candidate.candidate);
    }
    cb();
};

// Generate and emit an offer with the given constraints
PeerConnection.prototype.offer = function (constraints, cb) {
    function removeCodec(orgsdp, codec) {
        var internalFunc = function(sdp) {
            var codecre = new RegExp('(a=rtpmap:(\\d+)\\s'+codec +'\/90000)\\r\\n')
            var rtpmaps = sdp.match(codecre);
            if(rtpmaps == null || rtpmaps.length <= 2) {
                return sdp;
            }
            var rtpmap = rtpmaps[2];
            var modsdp = sdp.replace(codecre, "");

            var rtcpre = new RegExp('(a=rtcp-fb:' + rtpmap + '.*\r\n)', 'g');
            modsdp = modsdp.replace(rtcpre, "");

            var fmtpre = new RegExp('(a=fmtp:' + rtpmap + '.*\r\n)', 'g');
            modsdp = modsdp.replace(fmtpre, "");

            var aptpre = new RegExp('(a=fmtp:(\\d*) apt=' + rtpmap + '\\r\\n)');
            var aptmaps = modsdp.match(aptpre);
            var fmtpmap = "";
            if(aptmaps != null && aptmaps.length >= 3) {
                fmtpmap = aptmaps[2];
                modsdp = modsdp.replace(aptpre, "");

                var rtppre = new RegExp('(a=rtpmap:' + fmtpmap + '.*\r\n)', 'g');
                modsdp = modsdp.replace(rtppre, "");
            }

            var videore = /(m=video.*\r\n)/;
            var videolines = modsdp.match(videore);
            if(videolines != null) {
                //If many m=video are found in SDP, this program doesn't work.
                var videoline = videolines[0].substring(0, videolines[0].length - 2);
                var videoelem = videoline.split(" ");
                var modvideoline = videoelem[0];
                for(var i = 1; i < videoelem.length; i++) {
                    if(videoelem[i] == rtpmap || videoelem[i] == fmtpmap) {
                        continue;
                    }
                    modvideoline += " " + videoelem[i];
                }
                modvideoline += "\r\n";
                modsdp = modsdp.replace(videore, modvideoline);
            }
            return internalFunc(modsdp);
        };
        return internalFunc(orgsdp);
    }
    var self = this;
    var hasConstraints = arguments.length === 2;
    var mediaConstraints = hasConstraints && constraints ? constraints : {
            mandatory: {
                OfferToReceiveAudio: true,
                OfferToReceiveVideo: true
            }
        };
    cb = hasConstraints ? cb : constraints;
    cb = cb || function () {};

    if (mediaConstraints.calleeBrowser){
        delete mediaConstraints.calleeBrowser
    }
    if (mediaConstraints.callerBrowser){
        delete mediaConstraints.callerBrowser
    }

    if (this.pc.signalingState === 'closed') return cb('Already closed');

    // Actually generate the offer
    this.pc.createOffer(
        function (offer) {
            // does not work for jingle, but jingle.js doesn't need
            // this hack...
            var expandedOffer = {
                type: 'offer',
                sdp: offer.sdp
            };
            if (self.assumeSetLocalSuccess) {
                self.emit('offer', expandedOffer);
                cb(null, expandedOffer);
            }
            self._candidateBuffer = [];

            var transform = require('sdp-transform');

            offer.sdp = removeCodec(offer.sdp,"H264");
            offer.sdp = removeCodec(offer.sdp,"VP9");

           var sdpObj = transform.parse(offer.sdp);

            sdpObj.media.forEach(function(media){
                if (media.type === 'video') {
                    media.rtcpFb = [
                        {
                            "payload":100,
                            "type":"ccm",
                            "subtype":"fir"
                        },
                        {
                            "payload":100,
                            "type":"nack"
                        },
                        {
                            "payload":100,
                            "type":"nack",
                            "subtype":"pli"
                        },
                        {
                            "payload":100,
                            "type":"goog-remb"
                        },
                        {
                            "payload":100,
                            "type":"transport-cc"
                        },
                        {
                            "payload":101,
                            "type":"ccm",
                            "subtype":"fir"
                        },
                        {
                            "payload":101,
                            "type":"nack"
                        },
                        {
                            "payload":101,
                            "type":"nack",
                            "subtype":"pli"
                        },
                        {
                            "payload":101,
                            "type":"goog-remb"
                        },
                        {
                            "payload":101,
                            "type":"transport-cc"
                        }
                    ];

                    media.rtp = [
                        {
                            "payload":100,
                            "codec":"VP8",
                            "rate":90000
                        },
                        {
                            "payload":101,
                            "codec":"rtx",
                            "rate":90000
                        },
                    ];

                    media.fmtp = [
                        {
                            "payload":101,
                            "config":"apt=100"
                        }
                    ];

                    media.payloads = "100 101"
                }
            });

            offer.sdp = transform.write(sdpObj);



            ///Workaround for an issue https://bugs.chromium.org/p/webrtc/issues/detail?id=3962
            /*if(adapter.webrtcDetectedBrowser === 'chrome') {
             offer.sdp = offer.sdp.replace(/a=rtpmap:\d+ rtx\/\d+\r\n/i, "");
             offer.sdp = offer.sdp.replace(/a=fmtp:\d+ apt=\d+\r\n/i, "");
             }*/
            //Fixes an issue when call between Chrome and Firefox. and firefox offers 100 and 120 Payloads
            /*if(offer.sdp.indexOf('a=rtpmap:120 VP8/90000') >= 0 && offer.sdp.indexOf('a=rtpmap:100 VP8/90000') >= 0){
             offer.sdp = offer.sdp.replace(/a=rtpmap:120 VP8\/90000\r\n/i, "");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:120 nack\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:120 nack pli\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:120 ccm fir\r\n/i,"");
             }
             if(offer.sdp.indexOf('a=rtpmap:101 VP9/90000') >= 0){
             offer.sdp = offer.sdp.replace(/a=rtpmap:101 VP9\/90000\r\n/i, "");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:101 nack\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:101 nack pli\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:101 ccm fir\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:101 transport-cc\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:101 goog-remb\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtpmap:97 rtx\/90000\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=fmtp:97 apt=101\r\n/i,"");

             }
             if(offer.sdp.indexOf('a=rtpmap:107 H264/90000') >= 0){
             offer.sdp = offer.sdp.replace(/a=rtpmap:107 H264\/90000\r\n/i, "");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:107 nack\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:107 nack pli\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:107 ccm fir\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=fmtp:107 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:107 transport-cc\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtcp-fb:107 goog-remb\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtpmap:99 rtx\/90000\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=fmtp:99 apt=107\r\n/i,"");
             }

             offer.sdp = offer.sdp.replace(/a=rtpmap:98 rtx\/90000\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=fmtp:98 apt=116\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtpmap:96 rtx\/90000\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=fmtp:96 apt=100\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtpmap:116 red\/90000\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtpmap:117 ulpfec\/90000\r\n/i,"");*/



             /*offer.sdp = offer.sdp.replace(/a=rtpmap:97 rtx\/90000\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=fmtp:97 apt=96\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtpmap:102 red\/90000\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=rtpmap:127 ulpfec\/90000\r\n/i,"")
             offer.sdp = offer.sdp.replace(/a=rtpmap:125 rtx\/90000\r\n/i,"");
             offer.sdp = offer.sdp.replace(/a=fmtp:125 apt=102\r\n/i,"");*/

            self.pc.setLocalDescription(offer,
                function () {
                    var jingle;
                    if (self.config.useJingle) {
                        //To PlanB
                        if(adapter.webrtcDetectedBrowser === 'firefox' && self.isInitiator && self.calleeBrowser === 'chrome') {
                            offer.sdp = offer.sdp.replace(/a=mid:sdparta_1\r\n/i, "a=mid:video\r\n");
                            offer.sdp = offer.sdp.replace(/a=mid:sdparta_0\r\n/i, "a=mid:audio\r\n");
                            offer.sdp = offer.sdp.replace(/a=group:BUNDLE sdparta_0 sdparta_1\r\n/i, "a=group:BUNDLE audio video\r\n");
                        }
                        jingle = SJJ.toSessionJSON(offer.sdp, {
                            role: self._role(),
                            direction: 'outgoing'
                        });
                        jingle.sid = self.config.sid;
                        self.localDescription = jingle;

                        // Save ICE credentials
                        each(jingle.contents, function (content) {
                            var transport = content.transport || {};
                            if (transport.ufrag) {
                                self.config.ice[content.name] = {
                                    ufrag: transport.ufrag,
                                    pwd: transport.pwd
                                };
                            }
                        });

                        expandedOffer.jingle = jingle;
                    }
                    expandedOffer.sdp.split('\r\n').forEach(function (line) {
                        if (line.indexOf('a=candidate:') === 0) {
                            self._checkLocalCandidate(line);
                        }
                    });

                    if (!self.assumeSetLocalSuccess) {
                        self.emit('offer', expandedOffer);
                        cb(null, expandedOffer);
                    }
                },
                function (err) {
                    self.emit('error', err);
                    cb(err);
                }
            );
        },
        function (err) {
            self.emit('error', err);
            cb(err);
        },
        mediaConstraints
    );
};


// Process an incoming offer so that ICE may proceed before deciding
// to answer the request.
PeerConnection.prototype.handleOffer = function (offer, cb) {
    cb = cb || function () {
        };
    var self = this;
    offer.type = 'offer';
    if (offer.jingle) {

        if (this.enableChromeNativeSimulcast) {
            offer.jingle.contents.forEach(function (content) {
                if (content.name === 'video') {
                    content.description.googConferenceFlag = true;
                }
            });
        }
        if (this.enableMultiStreamHacks) {
            // add a mixed video stream as first stream
            offer.jingle.contents.forEach(function (content) {
                if (content.name === 'video') {
                    var sources = content.description.sources || [];
                    if (sources.length === 0 || sources[0].ssrc !== "3735928559") {
                        sources.unshift({
                            ssrc: "3735928559", // 0xdeadbeef
                            parameters: [
                                {
                                    key: "cname",
                                    value: "deadbeef"
                                },
                                {
                                    key: "msid",
                                    value: "mixyourfecintothis please"
                                }
                            ]
                        });
                        content.description.sources = sources;
                    }
                }
            });
        }
        if (self.restrictBandwidth > 0) {
            if (offer.jingle.contents.length >= 2 && offer.jingle.contents[1].name === 'video') {
                var content = offer.jingle.contents[1];
                var hasBw = content.description && content.description.bandwidth;
                if (!hasBw) {
                    offer.jingle.contents[1].description.bandwidth = {
                        type: 'AS',
                        bandwidth: self.restrictBandwidth.toString()
                    };
                    offer.sdp = SJJ.toSessionSDP(offer.jingle, {
                        sid: self.config.sdpSessionID,
                        role: self._role(),
                        direction: 'outgoing'
                    });
                }
            }
        }
        offer.sdp = SJJ.toSessionSDP(offer.jingle, {
            sid: self.config.sdpSessionID,
            role: self._role(),
            direction: 'incoming'
        });

        self.remoteDescription = offer.jingle;
    }
    offer.sdp.split('\r\n').forEach(function (line) {
        if (line.indexOf('a=candidate:') === 0) {
            self._checkRemoteCandidate(line);
        }
    });
    //To UnifiedPlan
    if(adapter.webrtcDetectedBrowser === 'firefox' && self.calleeBrowser === 'chrome' ) {
        offer.sdp = offer.sdp.replace(/a=mid:video\r\n/i, "a=mid:sdparta_1\r\n");
        offer.sdp = offer.sdp.replace(/a=mid:audio\r\n/i, "a=mid:sdparta_0\r\n");
        offer.sdp = offer.sdp.replace(/a=group:BUNDLE audio video\r\n/i, "a=group:BUNDLE sdparta_0 sdparta_1\r\n");
    }
    offer.sdp = offer.sdp.replace(/a=setup:passive\r\n/i, "a=setup:actpass\r\n");
    offer.sdp = offer.sdp.replace(/a=setup:passive\r\n/i, "a=setup:actpass\r\n");
    offer.sdp = offer.sdp.replace(/a=setup:active\r\n/i, "a=setup:actpass\r\n");
    offer.sdp = offer.sdp.replace(/a=setup:active\r\n/i, "a=setup:actpass\r\n");
    self.pc.setRemoteDescription(new RTCSessionDescription(offer),
        function () {
            cb();
        },
        cb
    );
};

// Answer an offer with audio only
PeerConnection.prototype.answerAudioOnly = function (cb) {
    var mediaConstraints = {
        mandatory: {
            OfferToReceiveAudio: true,
            OfferToReceiveVideo: false
        }
    };
    this._answer(mediaConstraints, cb);
};

// Answer an offer without offering to recieve
PeerConnection.prototype.answerBroadcastOnly = function (cb) {
    var mediaConstraints = {
        mandatory: {
            OfferToReceiveAudio: false,
            OfferToReceiveVideo: false
        }
    };
    this._answer(mediaConstraints, cb);
};

// Answer an offer with given  default is audio/video
PeerConnection.prototype.answer = function (constraints, cb) {
    var hasConstraints = arguments.length === 2;
    var callback = hasConstraints ? cb : constraints;
    if(navigator.mozGetUserMedia) {
        var answerOptions = {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        };
    } else {
        var answerOptions = {};
        answerOptions.mandatory = {};
        answerOptions.mandatory.OfferToReceiveAudio = true;
        answerOptions.mandatory.OfferToReceiveVideo = true;
    }

    var mediaConstraints = hasConstraints && constraints ? constraints : answerOptions;

    if (mediaConstraints.calleeBrowser){
        delete mediaConstraints.calleeBrowser
    }
    if (mediaConstraints.callerBrowser){
        delete mediaConstraints.callerBrowser
    }

    this._answer(mediaConstraints, callback);
};

// Process an answer
PeerConnection.prototype.handleAnswer = function (answer, cb) {
    cb = cb || function () {};
    var self = this;
    /*answer.jingle.contents.forEach(function (content) {
        if (content.name === 'audio') {
            var sources = content.description.sources || [];
            //if (sources.length === 0 || sources[0].ssrc !== "2976579765") {
            if (sources.length === 0) {
                sources.unshift({
                    ssrc: "2976579765",
                    parameters: [
                        {
                            key: "cname",
                            value: "mixer-hyixer"
                        },
                        {
                            key: "msid",
                            value: "mixed audio"
                        }
                    ]
                });
                content.description.sources = sources;
            }
        }
    });*/
    if (answer.jingle) {
        answer.sdp = SJJ.toSessionSDP(answer.jingle, {
            sid: self.config.sdpSessionID,
            role: self._role(),
            direction: 'incoming'
        });
        self.remoteDescription = answer.jingle;
    }
    answer.sdp.split('\r\n').forEach(function (line) {
        if (line.indexOf('a=candidate:') === 0) {
            self._checkRemoteCandidate(line);
        }
    });
    var sdp = SdpParser.parse(answer.sdp);
    sdp.media.forEach(function(media){
        if(media.type === 'video' && media.inactive && !media['ice-pwd'] && !media['ice-ufrag']) {
            delete media.fingerprint;
            media.port = 0;
            delete media.mid;
        }
    });
    answer.sdp = SdpParser.format(sdp);

    //To UnifiedPlan
    if(adapter.webrtcDetectedBrowser === 'firefox' && self.isInitiator && self.calleeBrowser === 'chrome') {
        answer.sdp = answer.sdp.replace(/a=mid:video\r\n/i, "a=mid:sdparta_1\r\n");
        answer.sdp = answer.sdp.replace(/a=mid:audio\r\n/i, "a=mid:sdparta_0\r\n");
        answer.sdp = answer.sdp.replace(/a=group:BUNDLE audio video\r\n/i, "a=group:BUNDLE sdparta_0 sdparta_1\r\n");
    }
    //Fixes an issue when Firefox swaps the DTLS role, and chrome then reporting ssl role conflict error.
    if(adapter.webrtcDetectedBrowser === 'chrome' && !self.isInitiator && self.callerBrowser === 'firefox') {
        answer.sdp = answer.sdp.replace(/a=setup:active\r\n/i, "a=setup:passive\r\n");
    }

    self.pc.setRemoteDescription(
        new RTCSessionDescription(answer),
        function () {
            if (self.wtFirefox) {
                window.setTimeout(function () {
                    self.firefoxcandidatebuffer.forEach(function (candidate) {
                        // add candidates later
                        self.pc.addIceCandidate(
                            new RTCIceCandidate(candidate),
                            function () { },
                            function (err) {
                                self.emit('error', err);
                            }
                        );
                        self._checkRemoteCandidate(candidate.candidate);
                    });
                    self.firefoxcandidatebuffer = null;
                }, self.wtFirefox);
            }
            cb(null);
        },
        cb
    );
};

// Close the peer connection
PeerConnection.prototype.close = function () {
    this.pc.close();

    this._localDataChannels = [];
    this._remoteDataChannels = [];

    this.emit('close');
};

// Internal code sharing for various types of answer methods
PeerConnection.prototype._answer = function (constraints, cb) {
    cb = cb || function () {};
    var self = this;
    if (!this.pc.remoteDescription) {
        // the old API is used, call handleOffer
        throw new Error('remoteDescription not set');
    }

    if (this.pc.signalingState === 'closed') return cb('Already closed');

    self.pc.createAnswer(
        function (answer) {
            var sim = [];
            if (self.enableChromeNativeSimulcast) {
                // native simulcast part 1: add another SSRC
                answer.jingle = SJJ.toSessionJSON(answer.sdp, {
                    role: self._role(),
                    direction: 'outgoing'
                });
                if (answer.jingle.contents.length >= 2 && answer.jingle.contents[1].name === 'video') {
                    var groups = answer.jingle.contents[1].description.sourceGroups || [];
                    var hasSim = false;
                    groups.forEach(function (group) {
                        if (group.semantics == 'SIM') hasSim = true;
                    });
                    if (!hasSim &&
                        answer.jingle.contents[1].description.sources.length) {
                        var newssrc = JSON.parse(JSON.stringify(answer.jingle.contents[1].description.sources[0]));
                        newssrc.ssrc = '' + Math.floor(Math.random() * 0xffffffff); // FIXME: look for conflicts
                        answer.jingle.contents[1].description.sources.push(newssrc);

                        sim.push(answer.jingle.contents[1].description.sources[0].ssrc);
                        sim.push(newssrc.ssrc);
                        groups.push({
                            semantics: 'SIM',
                            sources: sim
                        });

                        // also create an RTX one for the SIM one
                        var rtxssrc = JSON.parse(JSON.stringify(newssrc));
                        rtxssrc.ssrc = '' + Math.floor(Math.random() * 0xffffffff); // FIXME: look for conflicts
                        answer.jingle.contents[1].description.sources.push(rtxssrc);
                        groups.push({
                            semantics: 'FID',
                            sources: [newssrc.ssrc, rtxssrc.ssrc]
                        });

                        answer.jingle.contents[1].description.sourceGroups = groups;
                        answer.sdp = SJJ.toSessionSDP(answer.jingle, {
                            sid: self.config.sdpSessionID,
                            role: self._role(),
                            direction: 'outgoing'
                        });
                    }
                }
            }
            var expandedAnswer = {
                type: 'answer',
                sdp: answer.sdp
            };
            if (self.assumeSetLocalSuccess) {
                // not safe to do when doing simulcast mangling
                self.emit('answer', expandedAnswer);
                cb(null, expandedAnswer);
            }
            self._candidateBuffer = [];
            self.pc.setLocalDescription(answer,
                function () {
                    if (self.config.useJingle) {
                        //To PlanB
                        if(adapter.webrtcDetectedBrowser === 'firefox' && self.isInitiator && self.calleeBrowser === 'chrome') {
                            answer.sdp = answer.sdp.replace(/a=mid:sdparta_1\r\n/i, "a=mid:video\r\n");
                            answer.sdp = answer.sdp.replace(/a=mid:sdparta_0\r\n/i, "a=mid:audio\r\n");
                            answer.sdp = answer.sdp.replace(/a=group:BUNDLE sdparta_0 sdparta_1\r\n/i, "a=group:BUNDLE audio video\r\n");
                        }
                        var jingle = SJJ.toSessionJSON(answer.sdp, {
                            role: self._role(),
                            direction: 'outgoing'
                        });
                        jingle.sid = self.config.sid;
                        self.localDescription = jingle;
                        expandedAnswer.jingle = jingle;
                    }
                    if (self.enableChromeNativeSimulcast) {
                        // native simulcast part 2:
                        // signal multiple tracks to the receiver
                        // for anything in the SIM group
                        if (!expandedAnswer.jingle) {
                            expandedAnswer.jingle = SJJ.toSessionJSON(answer.sdp, {
                                role: self._role(),
                                direction: 'outgoing'
                            });
                        }
                        expandedAnswer.jingle.contents[1].description.sources.forEach(function (source, idx) {
                            // the floor idx/2 is a hack that relies on a particular order
                            // of groups, alternating between sim and rtx
                            source.parameters = source.parameters.map(function (parameter) {
                                if (parameter.key === 'msid') {
                                    parameter.value += '-' + Math.floor(idx / 2);
                                }
                                return parameter;
                            });
                        });
                        expandedAnswer.sdp = SJJ.toSessionSDP(expandedAnswer.jingle, {
                            sid: self.sdpSessionID,
                            role: self._role(),
                            direction: 'outgoing'
                        });
                    }
                    expandedAnswer.sdp.split('\r\n').forEach(function (line) {
                        if (line.indexOf('a=candidate:') === 0) {
                            self._checkLocalCandidate(line);
                        }
                    });
                    if (!self.assumeSetLocalSuccess) {
                        self.emit('answer', expandedAnswer);
                        cb(null, expandedAnswer);
                    }
                },
                function (err) {
                    self.emit('error', err);
                    cb(err);
                }
            );
        },
        function (err) {
            self.emit('error', err);
            cb(err);
        },
        constraints
    );
};

// Internal method for emitting ice candidates on our peer object
PeerConnection.prototype._onIce = function (event) {
    var self = this;
    if (event.candidate) {
        if (this.dontSignalCandidates) return;
        var ice = event.candidate;

        var expandedCandidate = {
            candidate: {
                candidate: ice.candidate,
                sdpMid: ice.sdpMid,
                sdpMLineIndex: ice.sdpMLineIndex
            }
        };
        this._checkLocalCandidate(ice.candidate);

        var cand = SJJ.toCandidateJSON(ice.candidate);

        var already;
        var idx;
        if (this.eliminateDuplicateCandidates && cand.type === 'relay') {
            // drop candidates with same foundation, component
            // take local type pref into account so we don't ignore udp
            // ones when we know about a TCP one. unlikely but...
            already = this._candidateBuffer.filter(
                function (c) {
                    return c.type === 'relay';
                }).map(function (c) {
                    return c.foundation + ':' + c.component;
                }
            );
            idx = already.indexOf(cand.foundation + ':' + cand.component);
            // remember: local type pref of udp is 0, tcp 1, tls 2
            if (idx > -1 && ((cand.priority >> 24) >= (already[idx].priority >> 24))) {
                // drop it, same foundation with higher (worse) type pref
                return;
            }
        }
        if (this.config.bundlePolicy === 'max-bundle') {
            // drop candidates which are duplicate for audio/video/data
            // duplicate means same host/port but different sdpMid
            already = this._candidateBuffer.filter(
                function (c) {
                    return cand.type === c.type;
                }).map(function (cand) {
                    return cand.address + ':' + cand.port;
                }
            );
            idx = already.indexOf(cand.address + ':' + cand.port);
            if (idx > -1) return;
        }
        // also drop rtcp candidates since
        if (this.config.rtcpMuxPolicy === 'require' && cand.component === '2') {
            return;
        }
        this._candidateBuffer.push(cand);

        if (self.config.useJingle) {
            if (!ice.sdpMid) { // firefox doesn't set this
                if (self.pc.remoteDescription && self.pc.remoteDescription.type === 'offer') {
                    // preserve name from remote
                    ice.sdpMid = self.remoteDescription.contents[ice.sdpMLineIndex].name;
                } else {
                    ice.sdpMid = self.localDescription.contents[ice.sdpMLineIndex].name;
                }
            }
            if (!self.config.ice[ice.sdpMid]) {
                var jingle = SJJ.toSessionJSON(self.pc.localDescription.sdp, {
                    role: self._role(),
                    direction: 'outgoing'
                });
                each(jingle.contents, function (content) {
                    var transport = content.transport || {};
                    if (transport.ufrag) {
                        self.config.ice[content.name] = {
                            ufrag: transport.ufrag,
                            pwd: transport.pwd
                        };
                    }
                });
            }
            expandedCandidate.jingle = {
                contents: [{
                    name: ice.sdpMid,
                    creator: self._role(),
                    transport: {
                        transType: 'iceUdp',
                        ufrag: self.config.ice[ice.sdpMid].ufrag,
                        pwd: self.config.ice[ice.sdpMid].pwd,
                        candidates: [
                            cand
                        ]
                    }
                }]
            };
            if (self.batchIceCandidates > 0) {
                if (self.batchedIceCandidates.length === 0) {
                    window.setTimeout(function () {
                        var contents = {};
                        self.batchedIceCandidates.forEach(function (content) {
                            content = content.contents[0];
                            if (!contents[content.name]) contents[content.name] = content;
                            contents[content.name].transport.candidates.push(content.transport.candidates[0]);
                        });
                        var newCand = {
                            jingle: {
                                contents: []
                            }
                        };
                        Object.keys(contents).forEach(function (name) {
                            newCand.jingle.contents.push(contents[name]);
                        });
                        self.batchedIceCandidates = [];
                        self.emit('ice', newCand);
                    }, self.batchIceCandidates);
                }
                self.batchedIceCandidates.push(expandedCandidate.jingle);
                return;
            }

        }
        this.emit('ice', expandedCandidate);
    } else {
        this.emit('endOfCandidates');
    }
};

// Internal method for processing a new data channel being added by the
// other peer.
PeerConnection.prototype._onDataChannel = function (event) {
    // make sure we keep a reference so this doesn't get garbage collected
    var channel = event.channel;
    this._remoteDataChannels.push(channel);

    this.emit('addChannel', channel);
};

// Create a data channel spec reference:
// http://dev.w3.org/2011/webrtc/editor/webrtc.html#idl-def-RTCDataChannelInit
PeerConnection.prototype.createDataChannel = function (name, opts) {
    var channel = this.pc.createDataChannel(name, opts);

    // make sure we keep a reference so this doesn't get garbage collected
    this._localDataChannels.push(channel);

    return channel;
};

// a wrapper around getStats which hides the differences (where possible)
// TODO: remove in favor of adapter.js shim
PeerConnection.prototype.getStats = function (cb) {
    if (adapter.webrtcDetectedBrowser === 'firefox') {
        this.pc.getStats(
            function (res) {
                var items = [];
                for (var result in res) {
                    if (typeof res[result] === 'object') {
                        items.push(res[result]);
                    }
                }
                cb(null, items);
            },
            cb
        );
    } else {
        this.pc.getStats(function (res) {
            var items = [];
            res.result().forEach(function (result) {
                var item = {};
                result.names().forEach(function (name) {
                    item[name] = result.stat(name);
                });
                item.id = result.id;
                item.type = result.type;
                item.timestamp = result.timestamp;
                items.push(item);
            });
            cb(null, items);
        });
    }
};

module.exports = PeerConnection;
