/* global angular, DeviceManager, RiftSandbox, Mousetrap */
(function () {
    'use strict';

    const LEAP_SCALE = 0.01;
    const LEAP_TRANSLATE = new THREE.Vector3(0, -1.6, -3.2);
	const CODE_HEADER = '"use strict";\n';
	const ROUND_FACTOR = 10;
	const DEBUG = false;
	
	function debugLog(s) {
		if (DEBUG) {
			console.log(s);
		}
	}

    var File = (function () {
        var constr = function (name, contents) {
            this.name = name || 'Example';
            var defaultContents = ('\
      var t3 = THREE;\n\
      var light = new t3.PointLight();\n\
      light.position.set(10, 15, 9);\n\
      scene.add(light);\n\
      var makeCube = function (x, y, z) {\n\
        var cube = new t3.Mesh(\n\
          new t3.BoxGeometry(1, 1.1, 1),\n\
          new t3.MeshLambertMaterial({color: \'red\'})\n\
        );\n\
        cube.scale.set(0.1, 0.1, 0.1);\n\
        cube.position.set(1, 0, -1).add(\n\
          new t3.Vector3(x, y, z));\n\
        scene.add(cube);\n\
        return cube;\n\
      };\n\
      \n\
      var rows, cols, cubes = [], spacing = 0.07;\n\
      rows = cols = 18;\n\
      for (var r = 0; r < rows; r++) {\n\
        for (var c = 0; c < cols; c++) {\n\
          if (c === 0) { cubes[r] = []; }\n\
          cubes[r][c] = makeCube(r * spacing, 0, c * spacing);\n\
        }\n\
      }\n\
      var i = 0;\n\
      return function () {\n\
        i += -0.05;\n\
        for (var r = 0; r < rows; r++) {\n\
          for (var c = 0; c < cols; c++) {\n\
            var height = (\n\
              Math.sin(r / rows * Math.PI * 2 + i) + \n\
              Math.cos(c / cols * Math.PI * 2 + i));\n\
            cubes[r][c].position.setY(height / 12 + 0.6);\n\
            cubes[r][c].material.color.setRGB(\n\
              height + 1.0, height + 0.5, 0.5);\n\
          }\n\
        }\n\
      };\
    '.replace(/\n {6}/g, '\n').replace(/^\s+|\s+$/g, ''));
            this.contents = contents === undefined ? defaultContents : contents;
            this.selected = true;
        };
        constr.prototype.findNumberAt = function (index) {
            return this.contents.substring(index).match(/-?\d+\.?\d*/)[0];
        };
        constr.prototype.spinNumber = function (number, direction, amount) {
            if (number.indexOf('.') === -1) {
                return (parseInt(number, 10) + direction * amount).toString();
            } else {
                return (parseFloat(number) + direction * amount).toFixed(2);
            }
        };
        constr.prototype.spinNumberAt = function (
            index, direction, amount, originalNumber
        ) {
            var number = this.findNumberAt(index);
            originalNumber = originalNumber || number;
            var newNumber = this.spinNumber(originalNumber, direction, amount);
            this.contents = (
                this.contents.substring(0, index) +
                newNumber +
                this.contents.substring(index + number.length)
            );
        };
        constr.prototype.recordOriginalNumberAt = function (index) {
            this.originalIndex = index;
            this.originalNumber = this.findNumberAt(index);
        };
        constr.prototype.offsetOriginalNumber = function (offset) {
            this.spinNumberAt(this.originalIndex, 1, offset, this.originalNumber);
        };
		
		// Sets a value at a particular text range.
		// Returns the range of the statement for highlighting purposes.
		constr.prototype.setValueAt = function (
            range, value
        ) {
            this.contents = (
                this.contents.substring(0, range[0]) +
                value +
                this.contents.substring(range[1])
            );
			return [range[0], range[0] + value.length];
        };
		
		
		// Adds a statement to the code that sets a mesh's position.
		// Returns the range of the statement for highlighting purposes.
        constr.prototype.hardcodeMeshPosition = function (
            index, identifier, x, y, z
        ) {
			var frontString = ";\n" + identifier + ".position.set(";
			var midString = x + ", " + y + ", " + z;
			var newCode = frontString + midString + ")";
            this.contents = (
                this.contents.substring(0, index) +
				newCode +
                this.contents.substring(index)
            );
			return [index + frontString.length, index + frontString.length + midString.length];
        };
		
        return constr;
    }());

    var Sketch = (function () {
        var constr = function (name, files) {
            this.name = name || 'Example Sketch';
            this.files = files || [
                new File()
            ];
        };
        constr.prototype.getCode = function () {
            var code = '';
            for (var i = 0; i < this.files.length; i++) {
                code += this.files[i].contents;
            }
            return code;
        };
        constr.prototype.addFile = function () {
            this.files.push(new File('Untitled', ''));
        };
        return constr;
    }());

    //--------------------------------
    // Angular module and controllers.
    //--------------------------------

    var module = angular.module('index', []);

    module.controller('SketchController', ['$scope',
        function ($scope) {
            // TODO: lol, this controller is out of control. Refactor and maybe actually
            // use Angular properly.
            navigator.getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
            navigator.getUserMedia({
                    video: true
                },
                function (stream) {
                    var monitor = document.getElementById('monitor');
                    monitor.src = window.URL.createObjectURL(stream);
                },
                function () {}
            );

            var autosave = localStorage.getItem('autosave');
            var files;
            if (autosave) {
                files = [new File('autosave', autosave)];
                $scope.sketch = new Sketch('autosave', files);
            } else {
                $scope.sketch = new Sketch(files);
            }

            // TODO: Most of this should be in a directive instead of in the controller.
            var mousePos = {
                x: 0,
                y: 0
            };
            window.addEventListener(
                'mousemove',
                function (e) {
                    mousePos.x = e.clientX;
                    mousePos.y = e.clientY;
                },
                false
            );

            this.sketchLoop = function () {};

            this.mainLoop = function () {
                window.requestAnimationFrame(this.mainLoop.bind(this));
                // HACK: I really need to turn this DOM manipulation into a directive.
                if (!this.textarea) {
                    this.textarea = document.querySelector('textarea');
                }

                // Apply movement
                if (this.deviceManager.sensorDevice) {
                    if (this.riftSandbox.vrMode) {
                        this.riftSandbox.setHmdPositionRotation(
                            this.deviceManager.sensorDevice.getState());
                    }
                    this.riftSandbox.setBaseRotation();
                    this.riftSandbox.updateCameraPositionRotation();
                }
                if (!this.deviceManager.sensorDevice || !this.riftSandbox.vrMode) {
                    this.riftSandbox.setRotation({
                        y: mousePos.x / window.innerWidth * Math.PI * 2
                    });
                    this.riftSandbox.setBaseRotation();
                    this.riftSandbox.updateCameraPositionRotation();
                }

                // Pick out the objects the user cares about (that is, that the user has named)
                //console.log("number of things in scene: " + this.riftSandbox.sceneStuff.length);
                var namedObjects = [];
                for (var i = 0; i < this.riftSandbox.sceneStuff.length; i++) {
                    if (this.riftSandbox.sceneStuff[i].name) {
                        namedObjects.push(this.riftSandbox.sceneStuff[i]);
                    }
                }

                this.riftSandbox.namedObjects = namedObjects;
                //console.log("There are " + this.riftSandbox.namedObjects.length + " named objects");

                try {
                    this.sketchLoop();
                } catch (err) {
                    if ($scope.error === null) {
                        $scope.error = err.toString();
                        if (!$scope.$$phase) {
                            $scope.$apply();
                        }
                    }
                }

                this.riftSandbox.render();
            };

            this.deviceManager = new DeviceManager();
			
			var pickLeapMesh = function (frame) {
				var namedObjects = this.riftSandbox.namedObjects;
				var mesh = null;
				
				if (frame.hands.length > 0 && frame.hands[0].fingers.length > 1) {
					var pos = frame.hands[0].fingers[1].tipPosition;
					this.riftSandbox.leapPos = [Math.round(pos[0] * ROUND_FACTOR) / ROUND_FACTOR, Math.round(pos[1] * ROUND_FACTOR) / ROUND_FACTOR, Math.round(pos[2] * ROUND_FACTOR) / ROUND_FACTOR];
					if(this.riftSandbox.leapMeshLocked) {
						// If a mesh is locked in, keep it as the selection.
						mesh = this.riftSandbox.leapMeshLocked;
					} else {
						// Otherwise, pick the nearest one to the user's index finger.
						var minDist = 1.5;
						for (var j = 0; j < namedObjects.length; j++) {
							var meshPos = namedObjects[j].position;
							var dist = Math.sqrt(Math.pow(meshPos.x - pos[0], 2) + Math.pow(meshPos.y - pos[1], 2) + Math.pow(meshPos.z - pos[2], 2));
							if (minDist < 0 || dist < minDist) {
								minDist = dist;
								mesh = namedObjects[j];
							}
						}
					}
				}
				if (mesh) {
					// Update mesh descriptor in interface.
					this.riftSandbox.leapMesh = mesh;
					this.setLeapInfoText("position: [" + mesh.position.x + ", " + mesh.position.y + ", " + mesh.position.z + "]");
					
					// Highlight selected mesh by surrounding it with a blue mesh.
					if (!this.riftSandbox.highlighterMesh) {
						this.riftSandbox.highlighterMesh = new THREE.Mesh(mesh.geometry, new THREE.MeshLambertMaterial({color: 'blue', transparent: true, opacity: 0.5}));
						this.riftSandbox.scene.riftSketch_addIntangible(this.riftSandbox.highlighterMesh);
					}
					this.riftSandbox.highlighterMesh.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
					this.riftSandbox.highlighterMesh.rotation.set(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z);
					this.riftSandbox.highlighterMesh.scale.set(1.1 * mesh.scale.x, 1.1 * mesh.scale.y, 1.1 * mesh.scale.z);
				} else {
					// Update mesh descriptor in interface.
					this.riftSandbox.scene.remove(this.riftSandbox.highlighterMesh);
					this.riftSandbox.leapMesh = null;
					this.riftSandbox.highlighterMesh = null;
					this.setLeapInfoText("No mesh selected.");
				}
			}.bind(this);
			
			this.setLeapInfoText = function(s) {
				$scope.leapInfoText = s;
				if (!$scope.$$phase) {
					$scope.$apply();
				}
			}.bind(this);

            // Set LeapMotion frame loop.
            this.handStart = this.handCurrent = null;
            this.altPressed = this.shiftPressed = false;
            Leap.loop({}, function (frame) {
                if (frame.hands.length) {
                    this.handCurrent = frame;
                    if (this.altPressed && this.handStart) {
                        var hand = frame.hands[0];
                        var handTranslation = hand.translation(this.handStart);
                        var factor = this.shiftPressed ? 10 : 100;
                        var offset = Math.round(handTranslation[1] / factor * 1000) / 1000;
                        offsetNumberAndKeepSelection(offset);
                    }
                }
				pickLeapMesh(frame);
                this.previousFrame = frame;
            }.bind(this));

            this.riftSandbox = new RiftSandbox(window.innerWidth, window.innerHeight);

            // Make riftSandbox accessible by child controllers.
            $scope.getRiftSandbox = function () {
                return this.riftSandbox;
            }.bind(this);

            this.deviceManager.onResizeFOV = function (
                renderTargetSize, fovLeft, fovRight
            ) {
                this.riftSandbox.setFOV(fovLeft, fovRight);
            }.bind(this);

            this.deviceManager.onHMDDeviceFound = function (hmdDevice) {
                var eyeOffsetLeft = hmdDevice.getEyeTranslation("left");
                var eyeOffsetRight = hmdDevice.getEyeTranslation("right");
                this.riftSandbox.setCameraOffsets(eyeOffsetLeft, eyeOffsetRight);
            }.bind(this);

            var spinNumberAndKeepSelection = function (direction, amount) {
                var start = this.textarea.selectionStart;
                $scope.sketch.files[0].spinNumberAt(start, direction, amount);
                if (!$scope.$$phase) {
                    $scope.$apply();
                }
                this.textarea.selectionStart = this.textarea.selectionEnd = start;
            }.bind(this);

            var offsetNumberAndKeepSelection = function (offset) {
                var start = this.textarea.selectionStart;
                $scope.sketch.files[0].offsetOriginalNumber(offset);
                if (!$scope.$$phase) {
                    $scope.$apply();
                }
                this.textarea.selectionStart = this.textarea.selectionEnd = start;
            }.bind(this);
			
			var setValueAndKeepSelection = function (range, value) {
				debugLog("setValueAndKeepSelection");
				
				var range = $scope.sketch.files[0].setValueAt(range, value);
			    if (!$scope.$$phase) {
					$scope.$apply();
				}
				
				// Highlight the added statement.
				this.textarea.selectionStart = range[0];
				this.textarea.selectionEnd = range[1];
			}.bind(this);

            var hardcodeMeshPositionAndKeepSelection = function (offset, name, x, y, z) {
				debugLog("setValueAndKeepSelection");
			
				var range = $scope.sketch.files[0].hardcodeMeshPosition(offset, name, x, y, z);
			    if (!$scope.$$phase) {
					$scope.$apply();
				}
				
				// Highlight the added statement.
				this.textarea.selectionStart = range[0];
				this.textarea.selectionEnd = range[1];
			}.bind(this);

            OAuth.initialize('bnVXi9ZBNKekF-alA1aF7PQEpsU');
            var apiCache = {};
            var api = _.throttle(function (provider, url, data, callback) {
                var cacheKey = url + JSON.stringify(data);
                var cacheEntry = apiCache[cacheKey];
                if (cacheEntry && (Date.now() - cacheEntry.lastCall) < 1000 * 60 * 5) {
                    callback(cacheEntry.data);
                    return;
                }
                OAuth.popup(
                    provider, {
                        cache: true
                    }
                ).done(function (result) {
                    result.get(
                        url, {
                            data: data,
                            cache: true
                        }
                    ).done(function (data) {
                        apiCache[cacheKey] = {
                            lastCall: Date.now(),
                            data: data
                        };
                        callback(data);
                    });
                });
            }, 1000);

            window.addEventListener(
                'resize',
                this.riftSandbox.resize.bind(this.riftSandbox),
                false
            );

            $scope.is_editor_visible = true;
            var domElement = this.riftSandbox.container;
            this.bindKeyboardShortcuts = function () {
                Mousetrap.bind('alt+v', function () {
                    this.riftSandbox.toggleVrMode();
                    if (domElement.mozRequestFullScreen) {
                        domElement.mozRequestFullScreen({
                            vrDisplay: this.deviceManager.hmdDevice
                        });
                    } else if (domElement.webkitRequestFullscreen) {
                        domElement.webkitRequestFullscreen({
                            vrDisplay: this.deviceManager.hmdDevice
                        });
                    }
                    return false;
                }.bind(this));
                Mousetrap.bind('alt+z', function () {
                    this.deviceManager.sensorDevice.zeroSensor();
                    return false;
                }.bind(this));
                Mousetrap.bind('alt+e', function () {
                    $scope.is_editor_visible = !$scope.is_editor_visible;
                    if (!$scope.$$phase) {
                        $scope.$apply();
                    }
                    return false;
                }.bind(this));
                Mousetrap.bind('alt+u', function () {
                    spinNumberAndKeepSelection(-1, 10);
                    return false;
                });
                Mousetrap.bind('alt+i', function () {
                    spinNumberAndKeepSelection(1, 10);
                    return false;
                });
                Mousetrap.bind('alt+j', function () {
                    spinNumberAndKeepSelection(-1, 1);
                    return false;
                });
                Mousetrap.bind('alt+k', function () {
                    spinNumberAndKeepSelection(1, 1);
                    return false;
                });
                Mousetrap.bind('alt+m', function () {
                    spinNumberAndKeepSelection(-1, 0.1);
                    return false;
                });
                Mousetrap.bind('alt+,', function () {
                    spinNumberAndKeepSelection(1, 0.1);
                    return false;
                });

                var MOVEMENT_RATE = 0.01;
                var ROTATION_RATE = 0.01;

                Mousetrap.bind('w', function () {
                    if (!$scope.is_editor_visible) {
                        this.riftSandbox.setVelocity(MOVEMENT_RATE);
                    }
                }.bind(this), 'keydown');
                Mousetrap.bind('w', function () {
                    if (!$scope.is_editor_visible) {
                        this.riftSandbox.setVelocity(0);
                    }
                }.bind(this), 'keyup');

                Mousetrap.bind('s', function () {
                    if (!$scope.is_editor_visible) {
                        this.riftSandbox.setVelocity(-MOVEMENT_RATE);
                    }
                }.bind(this), 'keydown');
                Mousetrap.bind('s', function () {
                    if (!$scope.is_editor_visible) {
                        this.riftSandbox.setVelocity(0);
                    }
                }.bind(this), 'keyup');

                Mousetrap.bind('a', function () {
                    if (!$scope.is_editor_visible) {
                        this.riftSandbox.BaseRotationEuler.y += ROTATION_RATE;
                    }
                }.bind(this));
                Mousetrap.bind('d', function () {
                    if (!$scope.is_editor_visible) {
                        this.riftSandbox.BaseRotationEuler.y -= ROTATION_RATE;
                    }
                }.bind(this));

                Mousetrap.bind('q', function () {
                    if (!$scope.is_editor_visible) {
                        this.riftSandbox.BaseRotationEuler.y += Math.PI / 4;
                    }
                }.bind(this));
                Mousetrap.bind('e', function () {
                    if (!$scope.is_editor_visible) {
                        this.riftSandbox.BaseRotationEuler.y -= Math.PI / 4;
                    }
                }.bind(this));

                Mousetrap.bind(['shift', 'alt+shift'], function () {
                    if (this.shiftPressed) {
                        return false;
                    }
                    this.shiftPressed = true;
                    return false;
                }.bind(this), 'keydown');
                Mousetrap.bind('shift', function () {
                    this.shiftPressed = false;
                    return false;
                }.bind(this), 'keyup');

                Mousetrap.bind('alt', function () {
                    if (this.altPressed) {
                        return false;
                    }
                    var start = this.textarea.selectionStart;
                    $scope.sketch.files[0].recordOriginalNumberAt(start);
                    this.handStart = this.handCurrent;
                    this.altPressed = true;
                    return false;
                }.bind(this), 'keydown');
                Mousetrap.bind('alt', function () {
                    this.altPressed = false;
                    return false;
                }.bind(this), 'keyup');

                // Jump to assignment of global reference to the Mesh selected by LeapMotion.
                Mousetrap.bind('ctrl+m', function () {
					// Find a global reference to the mesh.
					var mesh = esprimaFindLeapMeshReference();
					if (mesh) {
						var range = esprimaCalcTextAreaRange(mesh);
						this.textarea.selectionStart = range[0];
						this.textarea.selectionEnd = range[1];
                    } else {
						// Lack of coverage. Esprima could not find a reference to the mesh.
						throw "Failed to find Leap mesh reference";
					}
                }.bind(this, 'keydown'));
				
				// Hardcode a position statement for the Mesh selected by LeapMotion.
				Mousetrap.bind('ctrl+y', function () {
					// Lock Leap mesh if not locked already.
					if (!this.riftSandbox.leapMeshLocked) {
						this.riftSandbox.leapMeshLocked = this.riftSandbox.leapMesh;
					}
					
					if (this.riftSandbox.leapMesh) {
						// Move runtime mesh but do not update code yet.
						this.riftSandbox.leapMesh.position.set(this.riftSandbox.leapPos[0], this.riftSandbox.leapPos[1], this.riftSandbox.leapPos[2]);
					}
                }.bind(this), 'keydown');
				
				// Unlock leap mesh from the one that was being held and update code to move it.
				Mousetrap.bind('ctrl+y', function () {
					// Find a global reference to the mesh.
					var mesh = esprimaFindLeapMeshReference();
					if (mesh) {
						// Locate any calls to mesh.position.
						var calls = esprimaFindPositionCalls(mesh.id);
						
						if (calls.length > 0 && calls[calls.length - 1].expression.type == "CallExpression" && calls[calls.length - 1].expression.callee.property.name == "set") {
							// If calls to the global mesh's position exist and the last one is position.set, modify it to match Leap coordinates.
							
							// Find range in textarea to modify
							var args = calls[calls.length - 1].expression.arguments;
							var firstRange = esprimaCalcTextAreaRange(args[0]);
							var lastRange = esprimaCalcTextAreaRange(args[args.length - 1]);
							var totalRange = [firstRange[0], lastRange[1]];
							
							// Set cursor position and update code.
							setValueAndKeepSelection(totalRange, this.riftSandbox.leapPos[0] + ", " + this.riftSandbox.leapPos[1] + ", " + this.riftSandbox.leapPos[2]);
						} else {
							// Otherwise, add the position.set call to the code after the last call to the global mesh's position or the variable declaration.
							
							// Find range in textarea to modify
							var range;
							if (calls.length > 0) {
								range = esprimaCalcTextAreaRange(calls[calls.length - 1]);
							} else {
								range = esprimaCalcTextAreaRange(mesh);
							}
							
							// Set cursor position and insert code.
							hardcodeMeshPositionAndKeepSelection(range[1], mesh.id.name, this.riftSandbox.leapPos[0], this.riftSandbox.leapPos[1], this.riftSandbox.leapPos[2]);
						}
					} else {
						// Lack of coverage. Esprima could not find a reference to the mesh.
						throw "Failed to find Leap mesh reference";
					}
					
					// Unlock leap mesh.
					this.riftSandbox.leapMeshLocked = null;
                }.bind(this), 'keyup');
				
            }.bind(this);
            this.bindKeyboardShortcuts();

            var toggleVrMode = function () {
                if (!(document.mozFullScreenElement || document.webkitFullScreenElement) &&
                    this.riftSandbox.vrMode
                ) {
                    $scope.isInfullscreen = false;
                    if (!$scope.$$phase) {
                        $scope.$apply();
                    }
                    this.riftSandbox.toggleVrMode();
                } else {
                    $scope.isInfullscreen = true;
                    // Guesstimate that it's DK1 based on resolution. Ideally getVRDevices
                    // would give us a model name but it doesn't in Firefox.
                    if (window.innerWidth < 1800) {
                        $scope.isDK1 = true;
                    }
                    if (!$scope.$$phase) {
                        $scope.$apply();
                    }
                }
            }.bind(this);
            document.addEventListener('mozfullscreenchange', toggleVrMode, false);
            document.addEventListener('webkitfullscreenchange', toggleVrMode, false);

            this.riftSandbox.resize();

            // We only support a specific WebVR build at the moment.
            if (!navigator.userAgent.match('Firefox/34')) {
                $scope.seemsUnsupported = true;
            }
            this.deviceManager.onError = function () {
                $scope.seemsUnsupported = true;
                if (!$scope.$$phase) {
                    $scope.$apply();
                }
            }.bind(this);

            this.deviceManager.init();
            this.mainLoop();

            $scope.$watch('sketch.getCode()', function (code) {
                this.riftSandbox.clearScene();
				
	            // Use transform plugin
				Leap.loopController.use('transform', {
					// vr: true,
					position: LEAP_TRANSLATE,
					scale: LEAP_SCALE,
					effectiveParent: this.riftSandbox.camera
				});
				
				// Use custom bonehand rendering plugin
				Leap.loopController.use('customBoneHand', {
					scene: this.riftSandbox.scene,
                    arm: true,
                    render: (function () {
                        return function (timestamp) {
                            this.riftSandbox.render()
                        }
                    }).bind(this)
                });
				
                var _sketchLoop;
                $scope.error = null;
                try {
                    /* jshint -W054 */
                    this.codeHeader = CODE_HEADER;
                    var _sketchFunc = new Function(
                        'scene', 'camera', 'api',
                        this.codeHeader + code
                    );

                    /* jshint +W054 */
                    _sketchLoop = _sketchFunc(
                        this.riftSandbox.scene, this.riftSandbox.cameraPivot, api);
                } catch (err) {
                    $scope.error = err.toString();
                }
				
				// Parse with Esprima.
				this.esprimaOut = esprima.parse(_sketchFunc, {
					loc: true,
					range: true
				});

                if (_sketchLoop) {
                    this.sketchLoop = _sketchLoop;
                }
                localStorage.setItem('autosave', code);
            }.bind(this));
	
			var esprimaWalkForCondition = function(body, condition, stepOver) {
				var results = [];
				if (Object.prototype.toString.call(body) == "[object Array]") {
					for (var i = 0; i < body.length; i++) {
						results = results.concat(esprimaWalkForCondition(body[i], condition, stepOver));
					}
				} else if (condition(body)) {
					// Condition success, push to walk results.
					results.push(body);
				}  else if (body.declarations) {
					// Go through each declarator in a declarations array
					results = results.concat(esprimaWalkForCondition(body.declarations, condition, stepOver));
				} else if (!stepOver) {
					// Recurse inward if stepOver flag is not set
					if (body.init) {
						results = results.concat(esprimaWalkForCondition(body.init, condition, stepOver));
					} else if (body.body) {
						results = results.concat(esprimaWalkForCondition(body.body, condition, stepOver));
					}
				}
				return results;
			}.bind(this);

			var esprimaFindReturnStatement = function(body) {
				var results = esprimaWalkForCondition(body, function (body) {
					return body.type == "ReturnStatement";
				}, true);
				return results[0];
			}.bind(this);

			var esprimaFindVariableDeclaration = function(body, id) {
				var results = esprimaWalkForCondition(body, function (body) {
					return body.type == "VariableDeclarator" && body.id.type == "Identifier" && body.id.name == id.name;
				});
				return results[0].init;
			}.bind(this);
			
			var esprimaFindPositionCalls = function(id) {
				return esprimaWalkForCondition(this.esprimaOut.body[0].body.body, function (body) {
					return body.type == "ExpressionStatement" &&
								((body.expression.type == "CallExpression"
								&& body.expression.callee.type == "MemberExpression"
								&& body.expression.callee.object.type == "MemberExpression"
								&& body.expression.callee.object.object.type == "Identifier"
								&& body.expression.callee.object.object.name == id.name
								&& body.expression.callee.object.property.type == "Identifier"
								&& body.expression.callee.object.property.name == "position")
								|| (body.expression.type == "AssignmentExpression"
								&& body.expression.left.type == "MemberExpression"
								&& body.expression.left.object.type == "MemberExpression"
								&& body.expression.left.object.object.type == "Identifier"
								&& body.expression.left.object.object.name == id.name
								&& body.expression.left.object.property.type == "Identifier"
								&& body.expression.left.object.property.name == "position"));
				}, true);
			}.bind(this);
			
			var esprimaFindGlobalDeclarations = function() {
				var results = esprimaWalkForCondition(this.esprimaOut.body[0].body.body, function (body) {
					return body.type == "VariableDeclarator";
				}, true);
				return results;
			}.bind(this);

			var esprimaFindGlobalSceneAddCalls = function() {
				return esprimaWalkForCondition(this.esprimaOut.body[0].body.body, function (body) {
					return body.type == "ExpressionStatement"
							&& body.expression.type == "CallExpression"
							&& body.expression.callee.type == "MemberExpression"
							&& body.expression.callee.object.type == "Identifier"
							&& body.expression.callee.object.name == "scene"
							&& body.expression.callee.property.type == "Identifier"
							&& body.expression.callee.property.name == "add";
				}, true);
			}.bind(this);

			var esprimaCalcTextAreaRange = function(body) {
				var sketchFuncBegin = this.esprimaOut.body[0].body.body[0].range[0];
				var rangeOffset = sketchFuncBegin + CODE_HEADER.length;
				return [body.range[0] - rangeOffset, body.range[1] - rangeOffset];
			}.bind(this);
			
			var esprimaFindLeapMeshReference = function() {
				if (this.riftSandbox.leapMesh) {
					// Find line and column where the scene.add call originated in the global scope.
					var addPosition = extractSceneAddPosition(this.riftSandbox.leapMesh.riftSketch_stack);
					var position = extractGlobalReferencePosition(this.riftSandbox.leapMesh.riftSketch_stack);
					if (addPosition.line == position.line && addPosition.column == position.column) {
						// If scene.add was called in the global scope, iterate through esprima global scene.add calls to find which one matches the stack trace.
						var results = esprimaFindGlobalSceneAddCalls();
						for (var i = 0; i < results.length; i++) {
							var sketchFuncBeginLine = this.esprimaOut.body[0].body.body[0].loc.start.line;
							var sketchFuncLine = results[i].loc.start.line - sketchFuncBeginLine + 1;
							var sketchFuncColumn = results[i].loc.start.column + 1;
							if (sketchFuncLine == position.line && sketchFuncColumn == position.column) {
								// Correct scene.add call, search for the declaration of the mesh.
								var declarations = esprimaFindGlobalDeclarations();
								for (var ii = 0; ii < declarations.length; ii++) {
									if (declarations[ii].id.name == results[i].expression.arguments[0].name) {
										return declarations[ii];
									}
								}
							}
						}
					} else {
						// Otherwise, iterate through esprima global assignments to find which one matches the stack trace.
						var declarations = esprimaFindGlobalDeclarations();
						for (var i = 0; i < declarations.length; i++) {
							var sketchFuncBeginLine = this.esprimaOut.body[0].body.body[0].loc.start.line;
							var sketchFuncLine = declarations[i].init.loc.start.line - sketchFuncBeginLine + 1;
							var sketchFuncColumn = declarations[i].init.loc.start.column + 1;
							if (sketchFuncLine == position.line && sketchFuncColumn == position.column) {
								return declarations[i];
							}
						}
					}
				}
				return null;
			}.bind(this);
			
			var extractGlobalReferencePosition = function(stack) {
				var lines = stack.split("\n");
				for (var i = 0; i < lines.length; i++) {
					if (lines[i].split("@", 2)[0] == "anonymous") {
						var parts = lines[i].split(":");
						return {
							line: parts[parts.length - 2],
							column: parts[parts.length - 1],
						};
					}
				}
				return null;
			}.bind(this);
			
			var extractSceneAddPosition = function(stack) {
				var parts = stack.split("\n", 2)[1].split(":");
				return {
					line: parts[parts.length - 2],
					column: parts[parts.length - 1],
				};
			}.bind(this);
		}]);
}());