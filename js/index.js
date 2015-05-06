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
				
				// Re-project property mesh titles.
				updatePropertyMeshes();

                // Pick out the objects the user cares about (that is, that the user has named)
                var namedObjects = [];
                for (var i = 0; i < this.riftSandbox.sceneStuff.length; i++) {
                    if (this.riftSandbox.sceneStuff[i].name) {
                        namedObjects.push(this.riftSandbox.sceneStuff[i]);
                    }
                }

                this.riftSandbox.namedObjects = namedObjects;

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
			
			// Updates the position of the titleElement of each propertyMesh.
			var updatePropertyMeshes = function() {
				for (var i = 0; i < this.riftSandbox.propertyMeshes.length; i++) {
					var propertyMesh = this.riftSandbox.propertyMeshes[i];
					projectElement(propertyMesh.titleElement, propertyMesh.position);
				}
			}.bind(this);

            this.deviceManager = new DeviceManager();
			
			// Calculates the squared distance from a point to a line in 3d space.
			// The arguments are all type THREE.Vector3.
			var distToLine2 = function (point, lineStart, lineEnd) {
				var dLine = new THREE.Vector3().subVectors(lineEnd, lineStart);
				var dPointLine = new THREE.Vector3().subVectors(lineStart, point);
				return new THREE.Vector3().crossVectors(dLine, dPointLine).lengthSq() / dLine.lengthSq();
			}
			
			var leapMeshLoop = function (frame) {
				var namedObjects = this.riftSandbox.namedObjects;
				var mesh = null;
				
				if (frame.hands.length > 0 && frame.hands[0].fingers.length > 1) {
					var pos = frame.hands[0].fingers[1].tipPosition;
					this.riftSandbox.leapPos = [Math.round(pos[0] * ROUND_FACTOR) / ROUND_FACTOR, Math.round(pos[1] * ROUND_FACTOR) / ROUND_FACTOR, Math.round(pos[2] * ROUND_FACTOR) / ROUND_FACTOR];
					if(this.riftSandbox.leapMeshLocked) {
						// If a mesh is locked in, keep it as the selection.
						mesh = this.riftSandbox.leapMeshLocked;
						
						// Move runtime mesh but do not update code yet.
						mesh.position.set(this.riftSandbox.leapPos[0], this.riftSandbox.leapPos[1], this.riftSandbox.leapPos[2]);
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
					// Update mesh descriptor in interface and mesh reference.
					if (mesh != this.riftSandbox.leapMesh) {
						this.riftSandbox.leapMeshReference = esprimaFindMeshReference(mesh, 0);
						if (this.riftSandbox.highlighterMesh) {
							this.riftSandbox.scene.remove(this.riftSandbox.highlighterMesh);
						}
						this.riftSandbox.highlighterMesh = new THREE.Mesh(mesh.geometry, new THREE.MeshLambertMaterial({color: this.riftSandbox.leapMeshReference ? 'blue' : 'red', transparent: true, opacity: 0.5}));
						this.riftSandbox.scene.riftSketch_addIntangible(this.riftSandbox.highlighterMesh);
					}
					this.riftSandbox.leapMesh = mesh;
					this.setLeapInfoText("position: [" + mesh.position.x + ", " + mesh.position.y + ", " + mesh.position.z + "]");
					
					// Highlight selected mesh by surrounding it with a mesh (blue if reference found, red if not).
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
					// Removed this feature temporarily as it would fire when not wanted
                    if (false && this.altPressed && this.handStart) {
                        var hand = frame.hands[0];
                        var handTranslation = hand.translation(this.handStart);
                        var factor = this.shiftPressed ? 10 : 100;
                        var offset = Math.round(handTranslation[1] / factor * 1000) / 1000;
                        offsetNumberAndKeepSelection(offset);
                    }
                }
				leapMeshLoop(frame);
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
				var range = $scope.sketch.files[0].setValueAt(range, value);
			    if (!$scope.$$phase) {
					$scope.$apply();
				}
				
				// Highlight the added statement.
				this.textarea.selectionStart = range[0];
				this.textarea.selectionEnd = range[1];
			}.bind(this);

            var hardcodeMeshPositionAndKeepSelection = function (offset, name, x, y, z) {
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
					if (this.riftSandbox.leapMeshReference) {
						var range = esprimaCalcTextAreaRange(this.riftSandbox.leapMeshReference);
						this.textarea.selectionStart = range[0];
						this.textarea.selectionEnd = range[1];
                    }
                }.bind(this, 'keydown'));
				
				// Unlock leap mesh from the one that was being held and update code to move it.
				Mousetrap.bind('ctrl+y', function () {
					// If Leap mesh is not locked, lock it if its reference was found.
					if (!this.riftSandbox.leapMeshLocked) {
						if (this.riftSandbox.leapMeshReference) {
							this.riftSandbox.leapMeshLocked = this.riftSandbox.leapMesh;
						}
					} else {
						// Otherwise, find a global reference to the mesh and update it's code position.
						if (this.riftSandbox.leapMeshReference) {
							// Find the Identifier for both cases where leapMeshReference can be a VariableDeclarator (.id) or an AssignmentExpression (.left).
							var leapMeshId = this.riftSandbox.leapMeshReference.id ? this.riftSandbox.leapMeshReference.id : this.riftSandbox.leapMeshReference.left;
							if (leapMeshId) {
								// Locate any calls to mesh.position.
								var calls = esprimaFindPositionCalls(leapMeshId);
								
								var positionSetIdx = -1;
								for (var i = 0; i < calls.length; i++) {
									if (calls[i].type == "CallExpression" && calls[i].callee.property.name == "set") {
										positionSetIdx = i;
									}
								}
								if (positionSetIdx > -1) {
									// If calls to the global mesh's position exist and at least one is position.set, modify it to match Leap coordinates.
									
									// Find range in textarea to modify
									var args = calls[positionSetIdx].arguments;
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
										range = esprimaCalcTextAreaRange(this.riftSandbox.leapMeshReference);
									}
									
									// Set cursor position and insert code.
									hardcodeMeshPositionAndKeepSelection(range[1], leapMeshId.name, this.riftSandbox.leapPos[0], this.riftSandbox.leapPos[1], this.riftSandbox.leapPos[2]);
								}
							} else {
								// Reference was somehow lost between grabbing and releasing the mesh. This should not happen
								// but may occur if code is updated between the two events.
								throw "Failed to find Leap mesh reference";
							}
						} else {
							// Reference was somehow lost between grabbing and releasing the mesh. This should not happen
							// but may occur if code is updated between the two events.
							throw "Failed to find Leap mesh reference";
						}
						
						// Unlock leap mesh.
						this.riftSandbox.leapMeshLocked = null;
					}
                }.bind(this), 'keypress');
				
				// Show properties of the riftSketch_dataObject of the Leap mesh as intangible meshes.
				Mousetrap.bind('ctrl+shift+y', function () {
					// If Leap mesh is not currently being moved, display its properties.
					if (!this.riftSandbox.leapMeshLocked && this.riftSandbox.leapMesh && this.riftSandbox.leapMesh.riftSketch_dataObject) {
						// Remove any pre-existing property meshes.
						this.riftSandbox.clearPropertyMeshes();
						
						// Create a mesh for each property.
						var titleElements = [];
						var obj = this.riftSandbox.leapMesh.riftSketch_dataObject;
						for (var i in obj) {
							if (obj.hasOwnProperty(i)) {
								var propertyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshLambertMaterial({color: 'blue'}));
								propertyMesh.position.set(0, 0, 0).add(this.riftSandbox.leapMesh.position);
								var titleElement = createProjectedStringElement(i + "=" + obj[i]);
								propertyMesh.titleElement = titleElement;
								this.riftSandbox.propertyMeshes.push(propertyMesh);
							}
						}
						
						// Set mesh positions and add to scene.
						var angleOff = (2 * Math.PI) / this.riftSandbox.propertyMeshes.length;
						for (var i = 0; i < this.riftSandbox.propertyMeshes.length; i++) {
							var dispVector = new THREE.Vector3(1.5 * Math.cos(i * angleOff), 1.5 * Math.sin(i * angleOff), 0);
							this.riftSandbox.propertyMeshes[i].position.add(dispVector);
							this.riftSandbox.scene.add(this.riftSandbox.propertyMeshes[i]);
						}
					}
                }.bind(this), 'keypress');
				
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
                    arm: false,
					opacity: 0.2,
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
				debugLog(this.esprimaOut);

                if (_sketchLoop) {
                    this.sketchLoop = _sketchLoop;
                }
                localStorage.setItem('autosave', code);
            }.bind(this));
			
			// Text rendering
			
			var initTextRendering = function() {
				this.projector = new THREE.Projector();
			}.bind(this);
			
			var createProjectedStringElement = function(s) {
				var element = document.createElement('div');
				element.style.position = 'absolute';
				element.style.width = 100;
				element.style.height = 100;
				element.style.color = 'white';
				element.style.backgroundColor = 'black';
				element.innerHTML = s;
				document.body.appendChild(element);
				return element;
			}.bind(this);
			
			var projectElement = function(element, position) {
				this.riftSandbox.camera.updateMatrixWorld();
				var vector = this.projector.projectVector(position.clone(), this.riftSandbox.camera);
				element.style.left = (vector.x + 1) / 2 * window.innerWidth + 'px';
				element.style.top = -(vector.y - 1) / 2 * window.innerHeight + 'px';
			}.bind(this);
			
			initTextRendering();
			
			// Esprima functions
			
			var esprimaWalkForCondition = function(body, condition, stepOver) {
				var results = [];
				if (Object.prototype.toString.call(body) == "[object Array]") {
					// If node is an array, recurse on each element.
					for (var i = 0; i < body.length; i++) {
						results = results.concat(esprimaWalkForCondition(body[i], condition, stepOver));
					}
				}  else if (body.type == "VariableDeclaration" && body.declarations) {
					// If node is a declarations array, recurse on each declarator.
					results = results.concat(esprimaWalkForCondition(body.declarations, condition, stepOver));
				} else if (body.type == "ExpressionStatement" && body.expression) {
					// If node is a expression statement, recurse on the expression.
					results = results.concat(esprimaWalkForCondition(body.expression, condition, stepOver));
				} else if (condition(body)) {
					// If the condition succeeds, add to results.
					results.push(body);
				}
				
				// Additionally, check inward recursion.
				if (!stepOver) {
					var expr = null;
					if (body.type == "VariableDeclarator" && body.init) {
						expr = body.init;
					} else if (body.type == "AssignmentExpression" && body.right) {
						expr = body.right;
					}
					if (expr
							&& expr.type == "FunctionExpression"
							&& expr.body
							&& expr.body.type == "BlockStatement"
							&& expr.body.body) {
						// Recurse into functions if stepOver flag is not set
						results = results.concat(esprimaWalkForCondition(body.init.body.body, condition, stepOver));
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
					return (body.type == "CallExpression"
							&& body.callee.type == "MemberExpression"
							&& body.callee.object.type == "MemberExpression"
							&& body.callee.object.object.type == "Identifier"
							&& body.callee.object.object.name == id.name
							&& body.callee.object.property.type == "Identifier"
							&& body.callee.object.property.name == "position")
							|| (body.type == "AssignmentExpression"
							&& body.left.type == "MemberExpression"
							&& body.left.object.type == "MemberExpression"
							&& body.left.object.object.type == "Identifier"
							&& body.left.object.object.name == id.name
							&& body.left.object.property.type == "Identifier"
							&& body.left.object.property.name == "position");
				}, true);
			}.bind(this);
			
			var esprimaFindGlobalDeclarations = function() {
				return esprimaFindDeclarations(this.esprimaOut.body[0].body.body);
			}.bind(this);
			
			var esprimaFindDeclarations = function(body) {
				var results = esprimaWalkForCondition(body, function (body) {
					return body.type == "VariableDeclarator";
				}, true);
				return results;
			}.bind(this);
			
			var esprimaFindAllSceneAddCalls = function() {
				return esprimaWalkForCondition(this.esprimaOut.body[0].body.body, function (body) {
					return body.type == "CallExpression"
							&& body.callee
							&& body.callee.type == "MemberExpression"
							&& body.callee.object
							&& body.callee.object.type == "Identifier"
							&& body.callee.object.name == "scene"
							&& body.callee.property
							&& body.callee.property.type == "Identifier"
							&& body.callee.property.name == "add";
				});
			}.bind(this);

			var esprimaFindGlobalSceneAddCalls = function() {
				return esprimaWalkForCondition(this.esprimaOut.body[0].body.body, function (body) {
					return body.type == "CallExpression"
							&& body.callee.type == "MemberExpression"
							&& body.callee.object.type == "Identifier"
							&& body.callee.object.name == "scene"
							&& body.callee.property.type == "Identifier"
							&& body.callee.property.name == "add";
				}, true);
			}.bind(this);

			var esprimaCalcTextAreaRange = function(body) {
				var sketchFuncBegin = this.esprimaOut.body[0].body.body[0].range[0];
				var rangeOffset = sketchFuncBegin + CODE_HEADER.length;
				return [body.range[0] - rangeOffset, body.range[1] - rangeOffset];
			}.bind(this);
			
			// Recursively attempts to find a valid reference to the runtime mesh argument. The stackRecursion argument
			// details how far outward in the call stack the algorithm is. It should start at zero to examine the call to scene.add.
			// The return value is the AssignmentExpression or VariableDeclarator that assigns the reference in the global scope,
			// or null if the mesh could not be referenced in the global scope.
			var esprimaFindMeshReference = function(mesh, stackRecursion) {
				// Find line and column where the scene.add call originated in the global scope.
				var addPosition = extractSceneAddPosition(mesh.riftSketch_stack);
				var globalPosition = extractGlobalReferencePosition(mesh.riftSketch_stack);
				if (addPosition.line == globalPosition.line && addPosition.column == globalPosition.column) {
					// If scene.add was called in the global scope, iterate through esprima global scene.add calls to find which one matches the stack trace.
					var results = esprimaFindGlobalSceneAddCalls();
					for (var i = 0; i < results.length; i++) {
						var sketchFuncBeginLine = this.esprimaOut.body[0].body.body[0].loc.start.line;
						var sketchFuncLine = results[i].loc.start.line - sketchFuncBeginLine + 1;
						var sketchFuncColumn = results[i].loc.start.column + 1;
						if (sketchFuncLine == globalPosition.line && sketchFuncColumn == globalPosition.column) {
							// Correct scene.add call, search for the declaration of the mesh.
							var declarations = esprimaFindGlobalDeclarations();
							for (var ii = 0; ii < declarations.length; ii++) {
								if (declarations[ii].id.name == results[i].arguments[0].name) {
									return declarations[ii];
								}
							}
						}
					}
				} else {
					var stackPosition = extractStackReferencePosition(mesh.riftSketch_stack, stackRecursion + 1);
					// Node for the full body of the AssignmentExpression or VariableDeclarator that assigned the reference.
					var assignment;
					// Node for the sub-node of the reference. Left half of the assignment operator, or the argument if the reference
					// is in a function call like scene.add(reference).
					var reference;
					
					// Find variable of interest.
					if (stackRecursion == 0) {
						// Special case for top level scene.add since the variable of interest is an argument rather than an assignment.
						var results = esprimaFindAllSceneAddCalls();
						for (var i = 0; i < results.length; i++) {
							var sketchFuncBeginLine = this.esprimaOut.body[0].body.body[0].loc.start.line;
							var sketchFuncLine = results[i].loc.start.line - sketchFuncBeginLine + 1;
							var sketchFuncColumn = results[i].loc.start.column + 1;
							if (sketchFuncLine == stackPosition.line && sketchFuncColumn == stackPosition.column) {
								reference = results[i].arguments[0];
								break;
							}
						}
					} else {
						var assignment = esprimaFindVariableAssignment(stackPosition);
						if (!assignment) {
							// Return value was not assigned and mesh is inaccessible.
							return null;
						}
						if(assignment.type == "AssignmentExpression" && assignment.left) {
							reference = assignment.left;
						} else if (assignment.type == "VariableDeclarator" && assignment.id) {
							reference = assignment.id;
						}
					}
					
					if (stackPosition.line == globalPosition.line && stackPosition.column == globalPosition.column) {
						// If we are at global scope, return the assignment.
						return assignment;
					} else {
						// Otherwise, check if the reference was returned from the function.
						var scope = esprimaFindFunctionDefinition(reference.range);
						var body;
						if (scope.init && scope.init.body && scope.init.body.body) {
							body = scope.init.body.body;
						} else if (scope.right && scope.right.body && scope.right.body.body) {
							body = scope.right.body.body;
						}
						if (esprimaEvaluateFunctionReturnValiditity(body, reference)) {
							// If so, scope out and continue search.
							return esprimaFindMeshReference(mesh, stackRecursion + 1);
						}
					}
				}
			}.bind(this);
			
			// Gets an array of all statements inside the body argument that use the identifier of reference,
			// minus those that may not be valid do to reassignment.
			var esprimaFindValidReferenceStatements = function(body, reference) {
				return esprimaWalkForCondition(body, function(body) {
					var expr = null;
					if (body.type == "AssignmentExpression") {
						expr = body.left;
					} else if (body.type == "VariableDeclarator") {
						expr = body.id;
					}
					return (expr
							&& expr.type == "Identifier"
							&& expr.name == reference.name)
							|| (body.type == "ReturnStatement"
							&& body.argument.name == reference.name);
				}, true);
			}
			
			// Returns true if the body argument, the body of a function, returns the reference
			// and that reference has not encountered any calls that may have reassigned it
			// between its use in the reference argument and the return statement.
			var esprimaEvaluateFunctionReturnValiditity = function(body, reference) {
				var calls = esprimaFindValidReferenceStatements(body, reference);
				for (var i = 0; i < calls.length; i++) {
					if (calls[i].range[0] < reference.range[0]) {
						// Function returns before reference is used.
						if (calls[i].type == "ReturnStatement") {
							return false;
						}
					} else {
						// Reference is reassigned between its use in reference argment and the return statement,
						// function is not valid for returning the reference.
						if (calls[i].type == "AssignmentStatement") {
							return false;
						}
						// Reference properly returned after its use in reference argument.
						if (calls[i].type == "ReturnStatement") {
							return true;
						}
					}
				}
				return false;
			}.bind(this);
			
			// Returns the esprima node of the variable assignment found at stackPosition.
			var esprimaFindVariableAssignment = function(stackPosition) {
				var assignments = esprimaFindAllVariableAssignments();
				for (var i = 0; i < assignments.length; i++) {
					var expr;
					if (assignments[i].type == "AssignmentExpression" && assignments[i].right) {
						expr = assignments[i].right;
					} else if (assignments[i].type == "VariableDeclarator" && assignments[i].init) {
						expr = assignments[i].init;
					}
					var sketchFuncBeginLine = this.esprimaOut.body[0].body.body[0].loc.start.line;
					var sketchFuncLine = expr.loc.start.line - sketchFuncBeginLine + 1;
					var sketchFuncColumn = expr.loc.start.column + 1;
					if (sketchFuncLine == stackPosition.line && sketchFuncColumn == stackPosition.column) {
						return assignments[i];
					}
				}
				return null;
			}.bind(this);
			
			// Returns an array of all esprima nodes where variables are assigned.
			var esprimaFindAllVariableAssignments = function() {
				var results = esprimaWalkForCondition(this.esprimaOut.body[0].body.body, function (body) {
					return body.type == "AssignmentExpression"
							|| body.type == "VariableDeclarator";
				});
				return results;
			}.bind(this);
			
			// Returns the esprima node of the function definition within which the range argument falls.
			var esprimaFindFunctionDefinition = function(range) {
				var definitions = esprimaFindAllFunctionDefinitions();
				for (var i = 0; i < definitions.length; i++) {
					if (definitions[i].range[0] < range[0] && definitions[i].range[1] > range[1]) {
						return definitions[i];
					}
				}
				return null;
			}.bind(this);
			
			// Returns an array of all esprima nodes where functions are defined.
			var esprimaFindAllFunctionDefinitions = function() {
				var results = esprimaWalkForCondition(this.esprimaOut.body[0].body.body, function (body) {
					return (body.type == "AssignmentExpression"
							&& body.right
							&& (body.right.type == "FunctionDeclaration"
							|| body.right.type == "FunctionExpression"))
							|| (body.type == "VariableDeclarator"
							&& body.init
							&& (body.init.type == "FunctionDeclaration"
							|| body.init.type == "FunctionExpression"));
				});
				return results;
			}.bind(this);
			
			// Returns the position of the global call in the stack provided.
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
			
			// Returns the position where the call to scene.add should occur in the stack provided.
			var extractSceneAddPosition = function(stack) {
				return extractStackReferencePosition(stack, 1);
			}.bind(this);
			
			// Returns the idx'th call from the top in the stack. Index 1 should be to scene.add.
			var extractStackReferencePosition = function(stack, idx) {
				var lines = stack.split("\n");
				// Ensure the call is within bounds of the stack and within the scope of the user's code.
				if (idx < lines.length) {
					var parts = lines[idx].split(":");
					return {
						line: parts[parts.length - 2],
						column: parts[parts.length - 1],
					};
				}
				return null;
			}.bind(this);
		}]);
}());