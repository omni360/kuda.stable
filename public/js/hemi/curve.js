/* Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php */
/*
The MIT License (MIT)

Copyright (c) 2011 SRI International

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/**
 * @fileoverview This describes the objects needed to build the hemi particle
 *		effects: Bezier curves, particles which can follow those curves, and
 *		systems to manage particles and emitters. 
 */

var hemi = (function(hemi) {
	/**
	 * @namespace A module for curves and particle systems.
	 */
	hemi.curve = hemi.curve || {};
	
	var dbBoxMat =  new THREE.MeshPhongMaterial({
			color: 0x000088,
			wireframe: true,
			wireframeLinewidth: 1
		}),	
		dbgBoxTransforms = {},
		dbgLineMat = null,
		dbgLineTransforms = [];
	
////////////////////////////////////////////////////////////////////////////////
//                              	Constants	                              //
////////////////////////////////////////////////////////////////////////////////  

	/**
	 * Enum for different curve types, described below.
	 * <ul><pre>
	 * <li>hemi.curve.CurveType.Linear
	 * <li>hemi.curve.CurveType.Bezier
	 * <li>hemi.curve.CurveType.CubicHermite
	 * <li>hemi.curve.CurveType.LinearNorm
	 * <li>hemi.curve.CurveType.Cardinal
	 * <li>hemi.curve.CurveType.Custom
	 * </ul></pre>
	 */
	hemi.curve.CurveType = {
		Linear : 0,
		Bezier : 1,
		CubicHermite : 2,
		LinearNorm : 3,
		Cardinal : 4,
		Custom : 5
	};
	
	/**
	 * Predefined values for common shapes.
	 * <ul><pre>
	 * <li>hemi.curve.ShapeType.CUBE
	 * <li>hemi.curve.ShapeType.SPHERE
	 * <li>hemi.curve.ShapeType.ARROW
	 * </ul></pre>
	 */
	hemi.curve.ShapeType = {
		CUBE : 'cube',
		SPHERE : 'sphere',
		ARROW : 'arrow'
	};
	
////////////////////////////////////////////////////////////////////////////////
//                             Global Methods                                 //
////////////////////////////////////////////////////////////////////////////////  
	
	/**
	 * Create a curve particle system with the given configuration.
	 * 
	 * @param {hemi.Client} the client to create the system in
	 * @param {Object} cfg configuration options:
	 *     aim: flag to indicate particles should orient with curve
	 *     boxes: array of bounding boxes for particle curves to pass through
	 *     colors: array of values for particle color ramp (use this or colorKeys)
	 *     colorKeys: array of time keys and values for particle color ramp
	 *     fast: flag to indicate GPU-driven particle system should be used
	 *     life: lifetime of particle system (in seconds)
	 *     particleCount: number of particles to allocate for system
	 *     particleShape: enumerator for type of shape to use for particles
	 *     particleSize: size of the particles
	 *     scales: array of values for particle scale ramp (use this or scaleKeys)
	 *     scaleKeys: array of time keys and values for particle size ramp
	 *     tension: tension parameter for the curve (typically from -1 to 1)
	 *     // JS particle system only
	 *     parent: transform to parent the particle system under
	 *     // GPU particle system only
	 *     trail: flag to indicate system should have trailing start and stop
	 * @return {Object} the created particle system
	 */
	hemi.createCurveSystem = function(client, cfg) {
		var system;
		
		if (cfg.fast) {
			if (cfg.trail) {
				system = new hemi.GpuParticleTrail(client, cfg);
			} else {
				system = new hemi.GpuParticleCurveSystem(client, cfg);
			}
		} else {
			system = new hemi.ParticleCurveSystem(client, cfg);
		}
		
		return system;
	};
	
////////////////////////////////////////////////////////////////////////////////
//                              	Classes	                                  //
////////////////////////////////////////////////////////////////////////////////  
	
	/**
	 * @class A Box is defined by a minimum XYZ point and a maximum XYZ point.
	 * 
	 * @param {number[3]} opt_min minimum XYZ point
	 * @param {number[3]} opt_max maximum XYZ point
	 */
	hemi.curve.Box = function(opt_min, opt_max) {
		/**
		 * The minimum XYZ point
		 * @type number[3]
		 */
		this.min = opt_min || [];
		
		/**
		 * The maximum XYZ point
		 * @type number[3]
		 */
		this.max = opt_max || [];
	};
	
	/**
	 * @class A ColorKey contains a time key and a color value.
	 * 
	 * @param {number} key time value between 0 and 1
	 * @param {number[4]} color RGBA color value
	 */
	hemi.curve.ColorKey = function(key, color) {
		/**
		 * The time when the ColorKey is 100% of the Curve's color value.
		 * @type number
		 */
		this.key = key;
		
		/**
		 * The color value for Curve particles.
		 * @type number[4]
		 */
		this.value = color;
	};
	
	/**
	 * @class A ScaleKey contains a time key and a scale value.
	 * 
	 * @param {number} key time value between 0 and 1
	 * @param {number[3]} scale XYZ scale value
	 */
	hemi.curve.ScaleKey = function(key, scale) {
		/**
		 * The time when the ScaleKey is 100% of the Curve's scale value.
		 * @type number
		 */
		this.key = key;
		
		/**
		 * The scale value for Curve particles.
		 * @type number[3]
		 */
		this.value = scale;
	};

	/**
	 * @class A Curve is used to represent and calculate different curves
	 * including: linear, bezier, cardinal, and cubic hermite.
	 * 
	 * @param {number[3][]} points List of xyz waypoints 
	 * @param {hemi.curve.CurveType} opt_type Curve type
	 * @param {Object} opt_config Configuration object specific to this curve
	 */
	var Curve = function(points, opt_type, opt_config) {
		this.count = 0;
		this.tension = 0;
		this.type = opt_type;
		this.weights = [];
		this.xpts = [];
		this.xtans = [];
		this.ypts = [];
		this.ytans = [];
		this.zpts = [];
		this.ztans = [];
		
		if (points) {
			opt_config = opt_config || {};
			opt_config.points = points;
			this.loadConfig(opt_config);
		}
	}

//	/**
//	 * Get the Octane structure for the Curve.
//     *
//     * @return {Object} the Octane structure representing the Curve
//	 */
//	Curve.prototype.toOctane = function() {
//		var names = ['count', 'tension', 'weights', 'xpts', 'xtans', 'ypts',
//				'ytans', 'zpts', 'ztans'],
//			octane = {
//				type: 'hemi.curve.Curve',
//				props: []
//			};
//		
//		for (var ndx = 0, len = names.length; ndx < len; ndx++) {
//			var name = names[ndx];
//			
//			octane.props.push({
//				name: name,
//				val: this[name]
//			});
//		}
//		
//		octane.props.push({
//			name: 'setType',
//			arg: [this.type]
//		});
//		
//		return octane;
//	};
	
	/**
	 * Load the given configuration options into the Curve.
	 * 
	 * @param {Object} cfg configuration options for the Curve
	 */
	Curve.prototype.loadConfig = function(cfg) {
		var points = cfg.points,
			type = cfg.type || this.type || hemi.curve.CurveType.Linear;
		
		this.setType(type);
		
		if (points) {
			this.count = points.length;
			
			for (var i = 0; i < this.count; i++) {
				this.xpts[i] = points[i][0];
				this.ypts[i] = points[i][1];
				this.zpts[i] = points[i][2];
				this.xtans[i] = 0;
				this.ytans[i] = 0;
				this.ztans[i] = 0;
				this.weights[i] = 1;
			}
		}
		
		if (cfg.weights) {
			for (var i = 0; i < this.count; i++) {
				this.weights[i] = (cfg.weights[i] != null) ? cfg.weights[i] : 1;
			}
		}
		
		if (cfg.tangents) {
			for (var i = 0; i < this.count; i++) {
				if(cfg.tangents[i]) {
					this.xtans[i] = cfg.tangents[i][0] || 0;
					this.ytans[i] = cfg.tangents[i][1] || 0;
					this.ztans[i] = cfg.tangents[i][2] || 0;
				}	
			}
		}
		
		if(cfg.tension) {
			this.tension = cfg.tension;
		}
		
		this.setTangents();
	};
	
	/**
	 * Base interpolation function for this curve. Usually overwritten.
	 *
	 * @param {number} t time, usually between 0 and 1
	 * @return {number[3]} the position interpolated from the time input
	 */
	Curve.prototype.interpolate = function(t) {
		return [t,t,t];
	};

	/**
	 * The linear interpolation moves on a straight line between waypoints.
	 *
	 * @param {number} t time, usually between 0 and 1
	 * @return {number[3]} the position linearly interpolated from the time
	 *     input
	 */
	Curve.prototype.linear = function(t) {
		var n = this.count - 1;
		var ndx = Math.floor(t*n);
		if (ndx >= n) ndx = n-1;
		var tt = (t-ndx/n)/((ndx+1)/n-ndx/n);
		var x = (1-tt)*this.xpts[ndx] + tt*this.xpts[ndx+1];
		var y = (1-tt)*this.ypts[ndx] + tt*this.ypts[ndx+1];
		var z = (1-tt)*this.zpts[ndx] + tt*this.zpts[ndx+1];
		return [x,y,z];
	};

	/**
	 * The bezier interpolation starts at the first waypoint, and ends at
	 * the last waypoint, and 'bends' toward the intermediate points. These
	 * points can be weighted for more bending.
	 *
	 * @param {number} t time, usually between 0 and 1
	 * @return {number[3]} the position interpolated from the time input by
	 *     a bezier function.
	 */
	Curve.prototype.bezier = function(t) {
		var x = 0;
		var y = 0;
		var z = 0;
		var w = 0;
		var n = this.count;
		for(var i = 0; i < n; i++) {
			var fac = this.weights[i]*
			          hemi.utils.choose(n-1,i)*
				      Math.pow(t,i)*
					  Math.pow((1-t),(n-1-i));
			x += fac*this.xpts[i];
			y += fac*this.ypts[i];
			z += fac*this.zpts[i];
			w += fac; 
		}
		return [x/w,y/w,z/w];
	};

	/**
	 * The cubic hermite function interpolates along a line that runs
	 * through the Curve's waypoints at a predefined tangent slope through
	 * each one.
	 *
	 * @param {number} t time, usually between 0 and 1
	 * @return {number[3]} the position interpolated from the time input by
	 *     the cubic hermite function.
	 */
	Curve.prototype.cubicHermite = function(t) {
		var n = this.count - 1;
		var ndx = Math.floor(t*n);
		if (ndx >= n) ndx = n-1;
		var tt = (t-ndx/n)/((ndx+1)/n-ndx/n);
		var x = hemi.utils.cubicHermite(tt,this.xpts[ndx],this.xtans[ndx],this.xpts[ndx+1],this.xtans[ndx+1]);
		var y = hemi.utils.cubicHermite(tt,this.ypts[ndx],this.ytans[ndx],this.ypts[ndx+1],this.ytans[ndx+1]);
		var z = hemi.utils.cubicHermite(tt,this.zpts[ndx],this.ztans[ndx],this.zpts[ndx+1],this.ztans[ndx+1]);
		return [x,y,z];
	};
	
	/**
	 * The normalized linear interpolation moves on a straight line between
	 * waypoints at a constant velocity.
	 *
	 * @param {number} t time, usually between 0 and 1
	 * @return {number[3]} the position linearly interpolated from the time
	 *     input, normalized to keep the velocity constant
	 */
	Curve.prototype.linearNorm = function(t) {
		var d = 0;
		var dpts = [];
		dpts[0] = 0;
		for(var i = 1; i < this.count; i++) {
			d += hemi.core.math.distance([this.xpts[i-1],this.ypts[i-1],this.zpts[i-1]],
										 [this.xpts[i],this.ypts[i],this.zpts[i]]);
			dpts[i] = d;
		}
		var tt = t*d;
		var ndx = 0;
		for(var i = 0; i < this.count; i++) {
			if(dpts[i] < tt) ndx = i; 
		}
		var lt = (tt - dpts[ndx])/(dpts[ndx+1] - dpts[ndx]);
		var x = (1-lt)*this.xpts[ndx] + lt*this.xpts[ndx+1];
		var y = (1-lt)*this.ypts[ndx] + lt*this.ypts[ndx+1];
		var z = (1-lt)*this.zpts[ndx] + lt*this.zpts[ndx+1];			
		return [x,y,z];
	};
	
	/**
	 * Calculate the tangents for a cardinal curve, which is a cubic hermite
	 * curve where the tangents are defined by a single 'tension' factor.
	 */
	Curve.prototype.setTangents = function() {
		if (this.type == hemi.curve.CurveType.Cardinal) {
			var xpts = hemi.utils.clone(this.xpts),
				ypts = hemi.utils.clone(this.ypts),
				zpts = hemi.utils.clone(this.zpts);
			
			// Copy the first and last points in order to calculate tangents
			xpts.unshift(xpts[0]);
			xpts.push(xpts[xpts.length - 1]);
			ypts.unshift(ypts[0]);
			ypts.push(ypts[ypts.length - 1]);
			zpts.unshift(zpts[0]);
			zpts.push(zpts[zpts.length - 1]);
			
			for (var i = 0; i < this.count; i++) {
				this.xtans[i] = (1-this.tension)*(xpts[i+2]-xpts[i])/2;
				this.ytans[i] = (1-this.tension)*(ypts[i+2]-ypts[i])/2;
				this.ztans[i] = (1-this.tension)*(zpts[i+2]-zpts[i])/2;
			}
		}
	};
	
	/**
	 * Set the type of interpolation for the Curve.
	 * 
	 * @param {hemi.curve.CurveType} type interpolation type
	 */
	Curve.prototype.setType = function(type) {
		this.type = type;
		
		switch (type) {
			case hemi.curve.CurveType.Linear:
				this.interpolate = this.linear;
				break;
			case hemi.curve.CurveType.Bezier:
				this.interpolate = this.bezier;
				break;
			case hemi.curve.CurveType.CubicHermite:
			case hemi.curve.CurveType.Cardinal:
				this.interpolate = this.cubicHermite;
				break;
			case hemi.curve.CurveType.LinearNorm:
				this.interpolate = this.linearNorm;
				break;
			case hemi.curve.CurveType.Custom:
			default:
				break;
		}
	};
	
	/**
	 * Get the XYZ position of the last waypoint of the Curve.
	 * 
	 * @return {number[3]} the position of the last waypoint
	 */
	Curve.prototype.getEnd = function() {
		var end = this.count - 1;
		return [this.xpts[end],this.ypts[end],this.zpts[end]];
	};
	
	/**
	 * Get the XYZ position of the first waypoint of the Curve.
	 * 
	 * @return {number[3]} the position of the first waypoint
	 */
	Curve.prototype.getStart = function() {
		return [this.xpts[0],this.ypts[0],this.zpts[0]];
	};
	
	/**
	 * Draw the Curve using primitive shapes.
	 * 
	 * @param {number} samples the number of samples to use to draw
	 * @param {Object} config configuration for how the Curve should look
	 */
	Curve.prototype.draw = function(samples, config) {
		var points = [];
		for (var i = 0; i < samples+2; i++) {
			points[i] = this.interpolate(i/(samples+1));
		}
		drawCurve(points,config);
	};
	
	/**
	 * @class A Particle allows a Transform to move along a set of points.
	 * 
	 * @param {o3d.Transform} trans the transform to move along the curve
	 * @param {number[3][]} points the array of points to travel through
	 * @param {hemi.curve.ColorKey[]} colorKeys array of key-values for the 
	 *		color of the default material
	 * @param {hemi.curve.ScaleKey[]} scaleKeys array of key-values for the 
	 *		scale of the transform
	 * @param {boolean} rotate flag indicating if the Transform should rotate as
	 *      it travels through the points
	 */
	var Particle = function(trans, points, colorKeys, scaleKeys, rotate) {
		this.transform = new THREE.Object3D();
		trans.add(this.transform);
		this.transform.matrixAutoUpdate = false;
		
		this.frame = 1;
		this.lastFrame = points.length - 2;
		this.destroyed = false;
		this.material = new THREE.MeshPhongMaterial({
			color: 0x000000,
			transparent: true
		});
		
		this.lt = [];
		this.matrices = [];
		this.setColors(colorKeys);
		
		for (var i = this.frame; i <= this.lastFrame; i++) {
			var L = new THREE.Matrix4(),
				p = points[i];
			
			L.setTranslation(p[0], p[1], p[2]);
			
			if (rotate) {
				hemi.utils.pointYAt(L, points[i-1], points[i+1]);
			}
			
			this.lt[i] = L;
		}
		this.setScales(scaleKeys);
		this.ready = true;
		this.active = false;
	};
	
	/**
	 * Start this particle along the curve.
	 *
	 * @param {number} loops the number of loops to do
	 */
	Particle.prototype.run = function(loops) {
		this.loops = loops;
		this.ready = false;
		this.active = true;
	};

	/**
	 * Add a shape to the particle Transform.
	 *
	 * @param {THREE.Geometry} shape the shape to add
	 */
	Particle.prototype.addShape = function(shape) {
		this.transform.add(new THREE.Mesh(shape, this.material));
	};
	
	/**
	 * Remove all shapes from the particle transform.
	 */
	Particle.prototype.removeShapes = function() {
		for (var i = this.transform.children.length - 1; i >=0; i--) {
			this.transform.remove(this.transform.children[i]);
		}
	};
	
	/**
	 * Set the color gradient of this Particle.
	 * 
	 * @param {hemi.curve.ColorKey[]} colorKeys array of color key pairs
	 */
	Particle.prototype.setColors = function(colorKeys) {
		this.colors = [];
		if(colorKeys) {
			this.colorKeys = [];
			for (var i = 0; i < colorKeys.length; i++) {
				var p = {};
				var c = colorKeys[i];
				p.key = c.key;
				if (c.range) {
					p.value = [];
					if (typeof c.range == 'number') {
						var offset = (Math.random()-0.5)*2*c.range;
						for (var j = 0; j < c.value.length; j++) {
							p.value[j] = c.value[j] + offset;
						}
					} else {
						for (var j = 0; j < c.value.length; j++) {
							p.value[j] = c.value[j] + (Math.random()-0.5)*2*c.range[j];
						}
					}
				} else {
					p.value = c.value;
				}
				this.colorKeys[i] = p;
			}
		} else {
			this.colorKeys = [
				{key: 0, value: [0,0,0,1]},
				{key: 1, value: [0,0,0,1]}
				];
		}
		for (var i = 1; i <= this.lastFrame; i++) {		
			var time = (i-1)/(this.lastFrame-2);				
			this.colors[i] = this.lerpValue(time, this.colorKeys);			
		}
		return this;
	};
	
	/**
	 * Set the scale gradient of this particle.
	 * 
	 * @param {hemi.curve.ScaleKey[]} scaleKeys array of scale key pairs
	 */
	Particle.prototype.setScales = function(scaleKeys) {
		this.scales = [];
		if(scaleKeys) {
			var sKeys = [];
			for (var i = 0; i < scaleKeys.length; i++) {
				var p = {};
				var c = scaleKeys[i];
				p.key = c.key;
				if (c.range) {
					p.value = [];
					if (typeof c.range == 'number') {
						var offset = (Math.random()-0.5)*2*c.range;
						for (var j = 0; j < c.value.length; j++) {
							p.value[j] = c.value[j] + offset;
						}
					} else {
						for (var j = 0; j < c.value.length; j++) {
							p.value[j] = c.value[j] + (Math.random()-0.5)*2*c.range[j];
						}
					}
				} else {
					p.value = c.value;
				}
				sKeys[i] = p;
			}
		} else {
			sKeys = [
				{key: 0, value: [1,1,1]},
				{key: 1, value: [1,1,1]}
			];
		}
		for (var i = 1; i <= this.lastFrame; i++) {
			var time = (i-1)/(this.lastFrame-2),
				scale = this.scales[i] = this.lerpValue(time, sKeys);
			this.matrices[i] = new THREE.Matrix4().copy(this.lt[i]).scale(
				new THREE.Vector3(scale[0], scale[1], scale[2]));
		}
		return this;
	};

	/**
	 * Translate the Particle transform in local space.
	 *
	 * @param {number} x x translation
	 * @param {number} y y translation
	 * @param {number} z z translation
	 */
	Particle.prototype.translate = function(x, y, z) {
		this.transform.translateX(x);
		this.transform.translateY(y);
		this.transform.translateZ(z);
	};
	
	/**
	 * Given a set of key-values, return the interpolated value
	 *
	 * @param {number} time time, from 0 to 1
	 * @param {Object[]} keySet array of key-value pairs
	 * @return {number[]} the interpolated value
	 */
	Particle.prototype.lerpValue = function(time, keySet) {
		var ndx = keySet.length - 2;
		while(keySet[ndx].key > time) {
			ndx--;
		}
		var a = keySet[ndx],
			b = keySet[ndx+1],
			t = (time - a.key)/(b.key - a.key),
			r = [],
			aLength = a.value.length;
			
		for (var i = 0; i < aLength; ++i) {
			r[i] = (1 - t) * a.value[i] + t * b.value[i];
		}
			
		return r;
	};
	
	/**
	 * Update the particle (called on each render).
	 */
	Particle.prototype.update = function() {
		if (!this.active) return;
		
		var f = this.frame,
			c = this.colors[f];
		this.material.color.setRGB(c[0], c[1], c[2]);
		this.material.opacity = c[3];
		this.transform.matrixWorldNeedsUpdate = true;
		this.transform.matrix = this.matrices[f];
		this.frame++;
		this.transform.visible = true;
		for (var i = 0, il = this.transform.children.length; i < il; i++) {
			this.transform.children[i].visible = true;
		}
		
		if (this.frame >= this.lastFrame) {
			this.frame = 1;
			this.loops--;
			if (this.loops === 0) this.reset();
		}
	};
	
	/**
	 * Destroy this particle and all references to it.
	 */
	Particle.prototype.destroy = function() {
		if(this.destroyed) return;
		
		var t = this.transform,
			p = t.parent;
			
		for(var i = (t.children.length-1); i >= 0; i--) {
			t.remove(t.children[i]);
		}
		
		if (p) {
			p.remove(t);
		}
		
		this.transform = null;
		this.curve = null;
		this.destroyed = true;
	};
	
	/**
	 * Reset this particle.
	 */
	Particle.prototype.reset = function() {
		this.transform.visible = false;
		for (var i = 0, il = this.transform.children.length; i < il; i++) {
			this.transform.children[i].visible = false;
		}
		this.loops = this.totalLoops;
		this.destroyed = false;
		this.active = false;
		this.ready = true;
	};
	
	/**
	 * @class A ParticleCurveSystem manages a set of Particle objects, and fires
	 * them at the appropriate intervals.
	 * 
	 * @param {Object} config configuration object describing this system
	 */
	var ParticleCurveSystem = function(client, config) {
		this.transform = new THREE.Object3D();
		config.parent ? config.parent.add(this.transform) : client.scene.add(this.transform);
		
		this.active = false;
		this.pLife = config.life || 5;
		this.boxes = config.boxes;
		this.maxParticles = config.particleCount || 25;
		this.maxRate = Math.ceil(this.maxParticles / this.pLife);
		this.particles = [];
		this.pRate = this.maxRate;
		this.pTimer = 0.0;
		this.pTimerMax = 1.0 / this.pRate;
		this.pIndex = 0;
			
		this.shapeMaterial = new THREE.MeshBasicMaterial({
			color: 0xff0000,
			transparent: true
		});
		
		var type = config.particleShape || hemi.curve.ShapeType.CUBE,
			size = config.particleSize || 1;
		this.shapes = [];
		this.size = size;
		
		switch (type) {
			case (hemi.curve.ShapeType.ARROW):
				var halfSize = size / 2,
					thirdSize = size / 3;
				this.shapes.push(new THREE.ArrowGeometry(size, 
					size, halfSize, halfSize, size));
				break;
			case (hemi.curve.ShapeType.CUBE):
				this.shapes.push(new THREE.CubeGeometry(size, size, size));
				break;
			case (hemi.curve.ShapeType.SPHERE):
				this.shapes.push(new THREE.SphereGeometry(size, 12, 12));
				break;
		}
		
		hemi.addRenderListener(this);
		
		this.boxesOn = false;
		
		this.points = [];
		this.frames = config.frames || this.pLife*hemi.getFPS();
		
		for(var j = 0; j < this.maxParticles; j++) {
			var curve = this.newCurve(config.tension || 0);
			this.points[j] = [];
			for(var i=0; i < this.frames; i++) {
				this.points[j][i] = curve.interpolate((i)/this.frames);
			}
		}
		
		var colorKeys = null,
			scaleKeys = null;
		
		if (config.colorKeys) {
			colorKeys = config.colorKeys;
		} else if (config.colors) {
			var len = config.colors.length,
				step = len === 1 ? 1 : 1 / (len - 1);
			
			colorKeys = [];
			
			for (var i = 0; i < len; i++) {
				colorKeys.push({
					key: i * step,
					value: config.colors[i]
				});
			}
		}
		if (config.scaleKeys) {
			scaleKeys = config.scaleKeys;
		} else if (config.scales) {
			var len = config.scales.length,
				step = len === 1 ? 1 : 1 / (len - 1);
			
			scaleKeys = [];
			
			for (var i = 0; i < len; i++) {
				scaleKeys.push({
					key: i * step,
					value: config.scales[i]
				});
			}
		}
		
		for (i = 0; i < this.maxParticles; i++) {
			this.particles[i] = new Particle(
				this.transform,
				this.points[i],
				colorKeys,
				scaleKeys,
				config.aim);
			for (var j = 0; j < this.shapes.length; j++) {
				this.particles[i].addShape(this.shapes[j]);
			}
		}
	};
		
	/**
	 * Start the system.
	 */
	ParticleCurveSystem.prototype.start = function() {
		this.active = true;
	};
	
	/**
	 * Stop the system.
	 *
	 * @param {boolean} opt_hard If true, remove all particles immediately.
	 *     Otherwise, stop emitting but let existing particles finish.
	 */
	ParticleCurveSystem.prototype.stop = function(opt_hard) {
		this.active = false;
		if(opt_hard) {
			// Destroy All Particles
			for(var i = 0; i < this.maxParticles; i++) {
				if(this.particles[i] != null) {
					this.particles[i].reset();
				}
			}
		}
	};
	
	/**
	 * Update all existing particles on each render and emit new ones if
	 * needed.
	 *
	 * @param {o3d.RenderEvent} event event object describing details of the
	 *     render loop
	 */
	ParticleCurveSystem.prototype.onRender = function(event) {
		for(var i = 0; i < this.maxParticles; i++) {
			if(this.particles[i] != null) {
				this.particles[i].update(event);
			}
		}
		if(!this.active) return;
		this.pTimer += event.elapsedTime;
		if(this.pTimer >= this.pTimerMax) {
			this.pTimer = 0;
			var p = this.particles[this.pIndex];
			if (p.ready) p.run(1);
			this.pIndex++;
			if(this.pIndex >= this.maxParticles) this.pIndex = 0;
		}
	};
	
	/**
	 * Generate a new curve running through the system's bounding boxes.
	 * 
	 * @param {number} tension tension parameter for the Curve
	 * @return {hemi.curve.Curve} the randomly generated Curve
	 */
	ParticleCurveSystem.prototype.newCurve = function(tension) {
		var points = [];
		var num = this.boxes.length;
		for (var i = 0; i < num; i++) {
			var min = this.boxes[i].min;
			var max = this.boxes[i].max;
			points[i+1] = randomPoint(min,max);
		}
		points[0] = points[1].slice(0,3);
		points[num+1] = points[num].slice(0,3);
		var curve = new hemi.Curve(points,
			hemi.curve.CurveType.Cardinal, {tension: tension});
		return curve;
	};
	
	/**
	 * Remove all shapes from all particles in the system.
	 */
	ParticleCurveSystem.prototype.removeShapes = function() {
		for (var i = 0; i < this.maxParticles; i++) {
			this.particles[i].removeShapes();
		}
		this.shapes = [];
	};
	
	/**
	 * Add a shape which will be added to the Transform of every particle.
	 *
	 * @param {number|o3d.Shape} shape either an enum for standard shapes,
	 *     or a custom	predefined shape to add
	 */
	ParticleCurveSystem.prototype.addShape = function(shape) {
		var pack = hemi.curve.pack;
		var startndx = this.shapes.length;
		if (typeof shape == 'string') {
			var size = this.size;
			
			switch (shape) {
				case (hemi.curve.ShapeType.ARROW):
					var halfSize = size / 2,
						thirdSize = size / 3;
					this.shapes.push(new THREE.ArrowGeometry(size, 
						size, halfSize, halfSize, size));
					break;
				case (hemi.curve.ShapeType.CUBE):
					this.shapes.push(new THREE.CubeGeometry(size, size, size));
					break;
				case (hemi.curve.ShapeType.SPHERE):
					this.shapes.push(new THREE.SphereGeometry(size, 24, 12));
					break;
			}
		} else {
			this.shapes.push(shape);
		}
		for (var i = 0; i < this.maxParticles; i++) {
			for (var j = startndx; j < this.shapes.length; j++) {
				this.particles[i].addShape(this.shapes[j]);
			}
		}
	};
	
	/**
	 * Change the rate at which particles are emitted.
	 *
	 * @param {number} delta the delta by which to change the rate
	 * @return {number} the new rate
	 */
	ParticleCurveSystem.prototype.changeRate = function(delta) {
		return this.setRate(this.pRate + delta);
	};
	
	/**
	 * Set the emit rate of the system.
	 *
	 * @param {number} rate the rate at which to emit particles
	 * @return {number} the new rate - may be different because of bounds
	 */
	ParticleCurveSystem.prototype.setRate = function(rate) {
		var newRate = hemi.utils.clamp(rate, 0, this.maxRate);
		
		if (newRate === 0) {
			this.pTimerMax = 0;
			this.stop();
		} else {
			if (this.pRate === 0 && newRate > 0) {
				this.start();
			}
			this.pTimerMax = 1.0 / newRate;
		}
		
		this.pRate = newRate;
		return newRate;
	};
	
	/**
	 * Set the color gradient for this particle system.
	 * 
	 * @param {hemi.curve.ColorKey[]} colorKeys array of color key pairs
	 * @return {hemi.curve.ParticleCurveSystem} this system, for chaining
	 */
	ParticleCurveSystem.prototype.setColors = function(colorKeys) {
		for (var i = 0; i < this.maxParticles; i++) {
			this.particles[i].setColors(colorKeys);
		}
		return this;
	};

	/**
	 * Set the scale gradient for this particle system.
	 * 
	 * @param {hemi.curve.ScaleKey[]} scaleKeys array of scale key pairs
	 * @return {hemi.curve.ParticleCurveSystem} this system, for chaining
	 */		
	ParticleCurveSystem.prototype.setScales = function(scaleKeys) {
		for (var i = 0; i < this.maxParticles; i++) {
			this.particles[i].setScales(scaleKeys);
		}
		return this;
	};
	
	/**
	 * Render the bounding boxes which the particle system's curves run
	 * through (helpful for debugging).
	 */
	ParticleCurveSystem.prototype.showBoxes = function() {
		showBoxes.call(this);
	};

	/**
	 * Hide the particle system's bounding boxes from view.
	 */
	ParticleCurveSystem.prototype.hideBoxes = function() {
		hideBoxes.call(this);
	};
	
	/**
	 * Translate the entire particle system by the given amounts
	 * 
	 * @param {number} x amount to translate in the X direction
	 * @param {number} y amount to translate in the Y direction
	 * @param {number} z amount to translate in the Z direction
	 */
	ParticleCurveSystem.prototype.translate= function(x, y, z) {
		this.transform.position.addSelf(new THREE.Vector(x, y, z));
		this.transform.updateMatrix();
	};
	
	// START GPU PARTICLE SYSTEM
	
	
////////////////////////////////////////////////////////////////////////////////
//                               Shader Chunks                                //
////////////////////////////////////////////////////////////////////////////////   
	
	var shaderChunks = {
		vert: {
			header: 
				'uniform float sysTime; \n' +
				'uniform float ptcMaxTime; \n' +
				'uniform float ptcDec; \n' +
				'uniform float numPtcs; \n' +
				'uniform float tension; \n' +
				'uniform mat4 viewIT; \n' +
				'uniform vec3 minXYZ[NUM_BOXES]; \n' +
				'uniform vec3 maxXYZ[NUM_BOXES]; \n' +
				'attribute vec4 idOffset; \n' +
				'varying vec4 ptcColor; \n',
				
			headerColors:
				'uniform vec4 ptcColors[NUM_COLORS]; \n' +
				'uniform float ptcColorKeys[NUM_COLORS]; \n',
	
			headerScales:
				'uniform vec3 ptcScales[NUM_SCALES]; \n' +
				'uniform float ptcScaleKeys[NUM_SCALES]; \n',
	
			support:
				'float rand(vec2 co) { \n' +
				'  return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453); \n' +
				'} \n' +
				'vec3 randXYZ(vec2 co, vec3 min, vec3 max) { \n' +
				'  float rX = rand(vec2(co.x, co.x)); \n' +
				'  float rY = rand(vec2(co.y, co.y)); \n' +
				'  float rZ = rand(co); \n' +
				'  return vec3(mix(max.x, min.x, rX), \n' +
				'              mix(max.y, min.y, rY), \n' +
				'              mix(max.z, min.z, rZ)); \n' +
				'} \n' +
				'vec3 ptcInterp(float t, vec3 p0, vec3 p1, vec3 m0, vec3 m1) { \n' +
				'  float t2 = pow(t, 2.0); \n' +
				'  float t3 = pow(t, 3.0); \n' +
				'  return (2.0*t3 - 3.0*t2 + 1.0)*p0 + (t3 -2.0*t2 + t)*m0 + \n' +
				'   (-2.0*t3 + 3.0*t2)*p1 + (t3-t2)*m1; \n' +
				'} \n',
			
			// Unfortunately we have to do this in the vertex shader since the pixel
			// shader complains about non-constant indexing.
			supportColors:
				'void setPtcClr(float ptcTime) { \n' +
				'  if (ptcTime > 1.0) { \n' +
				'    ptcColor = vec4(0.0); \n' +
				'  } else { \n' +
				'    int ndx; \n' +
				'    float key; \n' +
				'    for (int i = 0; i < NUM_COLORS-1; i++) { \n' +
				'      if (ptcColorKeys[i] < ptcTime) { \n' +
				'        ndx = i; \n' +
				'        key = ptcColorKeys[i]; \n' +
				'      } \n' +
				'    } \n' +
				'    float t = (ptcTime - key)/(ptcColorKeys[ndx+1] - key); \n' +
				'    ptcColor = mix(ptcColors[ndx], ptcColors[ndx+1], t); \n' +
		//		'    ptcColor = vec4(t, 0.0, 0.0, 1.0); \n ' + //vec4(1.0, 0.0, 0.5, 1.0); \n' +
				'  } \n' +
				'} \n',
			
			supportNoColors:
				'void setPtcClr(float ptcTime) { \n' +
				'  if (ptcTime > 1.0) { \n' +
				'    ptcColor = vec4(0.0); \n' +
				'  } else { \n' +
				'    ptcColor = vec4(1.0); \n' +
				'  } \n' +
				'} \n',
			
			supportAim:
				'mat4 getRotMat(float t, vec3 p0, vec3 p1, vec3 m0, vec3 m1) { \n' +
				'  float tM = max(0.0,t-0.02); \n' +
				'  float tP = min(1.0,t+0.02); \n' +
				'  vec3 posM = ptcInterp(tM, p0, p1, m0, m1); \n' +
				'  vec3 posP = ptcInterp(tP, p0, p1, m0, m1); \n' +
				'  vec3 dPos = posP-posM; \n' +
				'  float dxz = sqrt(pow(dPos.x,2.0)+pow(dPos.z,2.0)); \n' +
				'  float dxyz = length(dPos); \n' +
				'  float cx = dPos.y/dxyz; \n' +
				'  float cy = dPos.z/dxz; \n' +
				'  float sx = dxz/dxyz; \n' +
				'  float sy = dPos.x/dxz; \n' +
				'  return mat4(cy,0.0,-1.0*sy,0.0, \n' +
				'   sx*sy,cx,sx*cy,0.0, \n' +
				'   cx*sy,-1.0*sx,cx*cy,0.0, \n' +
				'   0.0,0.0,0.0,1.0); \n' +
				'} \n',
			
			supportScale:
				'vec3 getScale(float ptcTime) { \n' +
				'  if (ptcTime > 1.0) { \n' +
				'    return vec3(1.0); \n' +
				'  } else { \n' +
				'    int ndx; \n' +
				'    float key; \n' +
				'    for (int i = 0; i < NUM_SCALES-1; i++) { \n' +
				'      if (ptcScaleKeys[i] < ptcTime) { \n' +
				'        ndx = i; \n' +
				'        key = ptcScaleKeys[i]; \n' +
				'      } \n' +
				'    } \n' +
				'    float t = (ptcTime - key)/(ptcScaleKeys[ndx+1] - key); \n' +
				'    return mix(ptcScales[ndx], ptcScales[ndx+1], t); \n' +
				'  } \n' +
				'} \n',
			
			bodySetup:
				'  float id = idOffset[0]; \n' +
				'  float offset = idOffset[1]; \n' +
				'  vec2 seed = vec2(id, numPtcs-id); \n' +
				'  float ptcTime = sysTime + offset; \n' +
				'  if (ptcTime > ptcMaxTime) { \n' +
				'    ptcTime -= ptcDec; \n' +
				'  } \n' +
				'  setPtcClr(ptcTime); \n' +
				'  if (ptcTime > 1.0) { \n' +
				'    ptcTime = 0.0; \n' +
				'  } \n' +
				'  float boxT = float(NUM_BOXES-1)*ptcTime; \n' +
				'  int ndx = int(floor(boxT)); \n' +
				'  float t = fract(boxT); \n' +
				'  vec3 p0 = randXYZ(seed,minXYZ[ndx],maxXYZ[ndx]); \n' +
				'  vec3 p1 = randXYZ(seed,minXYZ[ndx+1],maxXYZ[ndx+1]); \n' +
				'  vec3 m0; \n' +
				'  vec3 m1; \n' +
				'  if (ndx == 0) { \n' +
				'    m0 = vec3(0,0,0); \n' +
				'  } else { \n' +
				'    vec3 pm1 = randXYZ(seed,minXYZ[ndx-1],maxXYZ[ndx-1]); \n' +
				'    m0 = (p1-pm1)*tension; \n' +
				'  } \n' +
				'  if (ndx == NUM_BOXES-2) { \n' +
				'    m1 = vec3(0,0,0); \n' +
				'  } else { \n' +
				'    vec3 p2 = randXYZ(seed,minXYZ[ndx+2],maxXYZ[ndx+2]); \n' +
				'    m1 = (p2-p0)*tension; \n' +
				'  } \n' +
				'  vec3 pos = ptcInterp(t, p0, p1, m0, m1); \n' +
				'  mat4 tMat = mat4(1.0,0.0,0.0,0.0, \n' +
				'   0.0,1.0,0.0,0.0, \n' +
				'   0.0,0.0,1.0,0.0, \n' +
				'   pos.x,pos.y,pos.z,1.0); \n' +
				'  mat4 tMatIT = mat4(1.0,0.0,0.0,-1.0*pos.x, \n' +
				'   0.0,1.0,0.0,-1.0*pos.y, \n' +
				'   0.0,0.0,1.0,-1.0*pos.z, \n' +
				'   0.0,0.0,0.0,1.0); \n',
			
			bodyAim:
				'  mat4 rMat = getRotMat(t, p0, p1, m0, m1); \n',
			
			bodyNoAim:
				'  mat4 rMat = mat4(1.0); \n',
			
			bodyScale:
				'  vec3 scale = getScale(ptcTime); \n' +
				'  mat4 sMat = mat4(scale.x,0.0,0.0,0.0, \n' +
				'   0.0,scale.y,0.0,0.0, \n' +
				'   0.0,0.0,scale.z,0.0, \n' +
				'   0.0,0.0,0.0,1.0); \n',
			
			bodyNoScale:
				'  mat4 sMat = mat4(1.0); \n',
			
			bodyEnd:
				'  mat4 ptcWorld = tMat*rMat*sMat; \n' +
				'  mat4 ptcWorldViewIT = viewIT*tMatIT*rMat*sMat; \n' +
				'  mat3 ptcNorm = mat3(ptcWorldViewIT[0].xyz, ptcWorldViewIT[1].xyz, ptcWorldViewIT[2].xyz); \n' +
				'  mat4 ptcWorldView = viewMatrix * ptcWorld; \n'
		},
		frag: {
			header:
				'varying vec4 ptcColor; \n',
			
			bodySetup:
				'  if (ptcColor.a == 0.0) {\n' +
				'    discard;\n' +
				'  }\n',
			
			globNoColors:
				'gl_FragColor.a *= ptcColor.a; \n'
		}
	};
	
////////////////////////////////////////////////////////////////////////////////
//                           Gpu Particle Systems                             //
////////////////////////////////////////////////////////////////////////////////   
	
	/**
	 * @class A particle system that is GPU driven.
	 * @extends hemi.world.Citizen
	 * 
	 * @param {Object} opt_cfg optional configuration object for the system
	 */
	var GpuParticleCurveSystem = function(client, opt_cfg) {
		this.active = false;
		this.aim = false;
		this.boxes = [];
		this.colors = [];
		this.decParam = null;
		this.life = 0;
		this.material = null;
		this.materialSrc = null;
		this.maxTimeParam = null;
		this.particles = 0;
		this.ptcShape = 0;
		this.scales = [];
		this.size = 0;
		this.tension = 0;
		this.texNdx = -1;
		this.timeParam = null;
		this.viewITParam = null;
		this.transform = null;
		this.client = client;
		this.shaderMaterial = new THREE.ShaderMaterial();
		
		if (opt_cfg) {
			this.loadConfig(opt_cfg);
		}
	};
		
	/**
	 * Hide the particle system's bounding boxes from view.
	 */
	GpuParticleCurveSystem.prototype.hideBoxes = function() {
		hideBoxes.call(this);
	};
	
	/**
	 * Load the given configuration object and set up the GpuParticleCurveSystem.
	 * 
	 * @param {Object} cfg configuration object
	 */
	GpuParticleCurveSystem.prototype.loadConfig = function(cfg) {
		this.aim = cfg.aim == null ? false : cfg.aim;
		this.boxes = cfg.boxes ? hemi.utils.clone(cfg.boxes) : [];
		this.life = cfg.life || 5;
		this.particles = cfg.particleCount || 1;
		this.size = cfg.particleSize || 1;
		this.tension = cfg.tension || 0;
		
		if (cfg.colorKeys) {
			this.setColorKeys(cfg.colorKeys);
		} else if (cfg.colors) {
			this.setColors(cfg.colors);
		} else {
			this.colors = [];
		}
		
		if (cfg.scaleKeys) {
			this.setScaleKeys(cfg.scaleKeys);
		} else if (cfg.scales) {
			this.setScales(cfg.scales);
		} else {
			this.scales = [];
		}
		
		this.setMaterial(cfg.material || newMaterial());
		this.setParticleShape(cfg.particleShape || hemi.curve.ShapeType.CUBE);
	};
	
	/**
	 * Update the particles on each render.
	 * 
	 * @param {o3d.RenderEvent} e the render event
	 */
	GpuParticleCurveSystem.prototype.onRender = function(e) {
		var delta = e.elapsedTime / this.life,
			newTime = this.timeParam.value + delta;
		
		while (newTime > 1.0) {
			--newTime;
		}
		
		// refresh uniforms
		this.timeParam.value = newTime;
		this.viewITParam.value.copy(this.client.camera.threeCamera.matrixWorld).transpose();
	};
	
	/**
	 * Pause the particle system.
	 */
	GpuParticleCurveSystem.prototype.pause = function() {
		if (this.active) {
			hemi.removeRenderListener(this);
			this.active = false;
		}
	},
	
	/**
	 * Resume the particle system.
	 */
	GpuParticleCurveSystem.prototype.play = function() {
		if (!this.active) {
			if (this.maxTimeParam.value === 1.0) {
				hemi.addRenderListener(this);
				this.active = true;
			} else {
				this.start();
			}
		}
	};
	
	/**
	 * Set whether or not particles should orient themselves along the curve
	 * they are following.
	 * 
	 * @param {boolean} aim flag indicating if particles should aim
	 */
	GpuParticleCurveSystem.prototype.setAim = function(aim) {
		if (this.aim !== aim) {
			this.aim = aim;
			this.setupShaders()
		}
	};
	
	/**
	 * Set the bounding boxes that define waypoints for the particle
	 * system's curves.
	 * 
	 * @param {hemi.curve.Box[]} boxes array of boxes defining volumetric
	 *     waypoints for the particle system
	 */
	GpuParticleCurveSystem.prototype.setBoxes = function(boxes) {
		var oldLength = this.boxes.length;
		this.boxes = hemi.utils.clone(boxes);
		
		if (this.boxes.length === oldLength) {
			setupBounds(this.material, this.boxes);
		} else {
			this.setupShaders()
		}
	};
	
	/**
	 * Set the color ramp for the particles as they travel along the curve.
	 * 
	 * @param {number[4][]} colors array of RGBA color values
	 */
	GpuParticleCurveSystem.prototype.setColors = function(colors) {
		var len = colors.length,
			step = len === 1 ? 1 : 1 / (len - 1),
			colorKeys = [];
		
		for (var i = 0; i < len; i++) {
			colorKeys.push({
				key: i * step,
				value: colors[i]
			});
		}
		
		this.setColorKeys(colorKeys);
	};
	
	/**
	 * Set the color ramp for the particles as they travel along the curve,
	 * specifying the interpolation times for each color.
	 * 
	 * @param {hemi.curve.ColorKey[]} colorKeys array of color keys, sorted
	 *     into ascending key order
	 */
	GpuParticleCurveSystem.prototype.setColorKeys = function(colorKeys) {
		var len = colorKeys.length;
		
		if (len === 1) {
			// We need at least two to interpolate
			var clr = colorKeys[0].value;
			this.colors = [{
				key: 0,
				value: clr
			}, {
				key: 1,
				value: clr
			}];
		} else if (len > 1) {
			// Just make sure the keys run from 0 to 1
			colorKeys[0].key = 0;
			colorKeys[colorKeys.length - 1].key = 1;
			this.colors = colorKeys;
		} else {
			this.colors = [];
		}
		
		this.setupShaders()
	};
	
	/**
	 * Set the lifetime of the particle system.
	 * 
	 * @param {number} life the lifetime of the system in seconds
	 */
	GpuParticleCurveSystem.prototype.setLife = function(life) {
		if (life > 0) {
			this.life = life;
		}
	};
	
	/**
	 * Set the material to use for the particles. Note that the material's
	 * shader will be modified for the particle system.
	 * 
	 * @param {o3d.Material} material the material to use for particles
	 */
	GpuParticleCurveSystem.prototype.setMaterial = function(material) {
		this.material = material;
		
		if (!material.program) {
			var scene = this.client.scene;
			this.client.renderer.initMaterial(material, scene.lights, 
				scene.fog, this.transform);
		}
		
		var shads = hemi.utils.getShaders(this.client, material);
		
		this.materialSrc = {
			frag: shads.fragSrc,
			vert: shads.vertSrc
		};
			
		this.setupShaders();
	};
	
	/**
	 * Set the total number of particles for the system to create.
	 *  
	 * @param {number} numPtcs number of particles
	 */
	GpuParticleCurveSystem.prototype.setParticleCount = function(numPtcs) {
		this.particles = numPtcs;
		
		if (this.ptcShape) {
			// Recreate the custom vertex buffers
			this.setParticleShape(this.ptcShape);
		}
	};
	
	/**
	 * Set the size of each individual particle. For example, this would be
	 * the radius if the particles are spheres.
	 * 
	 * @param {number} size size of the particles
	 */
	GpuParticleCurveSystem.prototype.setParticleSize = function(size) {
		this.size = size;
		
		if (this.ptcShape) {
			// Recreate the custom vertex buffers
			this.setParticleShape(this.ptcShape);
		}
	};
	
	/**
	 * Set the shape of the particles to one of the predefined shapes. This
	 * may take some time as a new vertex buffer gets created.
	 * 
	 * @param {hemi.curve.ShapeType} type the type of shape to use
	 */
	GpuParticleCurveSystem.prototype.setParticleShape = function(type) {			
		this.ptcShape = type;
		
		if (this.transform) {
			this.transform.parent ? this.client.scene.remove(this.transform) : null;
			this.transform = null;
		}
		
		this.material = this.material || newMaterial();
		this.particles = this.particles || 1;
		
		var size = this.size,
			mat = this.material;
		
		switch (type) {
			case (hemi.curve.ShapeType.ARROW):
				var halfSize = size / 2,
					thirdSize = size / 3;
				this.transform = new THREE.Mesh(new THREE.ArrowGeometry(
					size, size, halfSize, halfSize, size),
					mat);
				break;
			case (hemi.curve.ShapeType.CUBE):
				this.transform = new THREE.Mesh(
					new THREE.CubeGeometry(size, size, size), mat);
				break;
			case (hemi.curve.ShapeType.SPHERE):
				this.transform = new THREE.Mesh(
					new THREE.SphereGeometry(size, 12, 12), mat);
				break;
		}
		
		this.client.scene.add(this.transform);
		var retVal = modifyGeometry(this.transform.geometry, this.particles);
		this.idArray = retVal.ids;
		this.offsetArray = retVal.offsets;
		this.idOffsets = retVal.idOffsets;
		
		this.setupShaders();
	};
	
	/**
	 * Set the scale ramp for the particles as they travel along the curve.
	 * 
	 * @param {number[3][]} scales array of XYZ scale values
	 */
	GpuParticleCurveSystem.prototype.setScales = function(scales) {
		var len = scales.length,
			step = len === 1 ? 1 : 1 / (len - 1),
			scaleKeys = [];
		
		for (var i = 0; i < len; i++) {
			scaleKeys.push({
				key: i * step,
				value: scales[i]
			});
		}
		
		this.setScaleKeys(scaleKeys);
	};
	
	/**
	 * Set the scale ramp for the particles as they travel along the curve,
	 * specifying the interpolation times for each scale.
	 * 
	 * @param {hemi.curve.ScaleKey[]} scaleKeys array of scale keys, sorted
	 *     into ascending key order
	 */
	GpuParticleCurveSystem.prototype.setScaleKeys = function(scaleKeys) {
		var len = scaleKeys.length;
		
		if (len === 1) {
			// We need at least two to interpolate
			var scl = scaleKeys[0].value;
			this.scales = [{
				key: 0,
				value: scl
			}, {
				key: 1,
				value: scl
			}];
		} else if (len > 1) {
			// Just make sure the keys run from 0 to 1
			scaleKeys[0].key = 0;
			scaleKeys[len - 1].key = 1;
			this.scales = scaleKeys;
		} else {
			this.scales = [];
		}
		
		this.setupShaders()
	};
	
	/**
	 * Set the tension parameter for the curve. This controls how round or
	 * straight the curve sections are.
	 * 
	 * @param {number} tension tension value (typically from -1 to 1)
	 */
	GpuParticleCurveSystem.prototype.setTension = function(tension) {
		this.tension = tension;
		
		if (this.material) {
			this.material.getParam('tension').value = (1 - this.tension) / 2;
		}
	};
	
	/**
	 * Modify the particle material's shaders so that the particle system
	 * can be rendered using its current configuration. At a minimum, the
	 * material, custom texture index, and curve boxes need to be defined.
	 */
	GpuParticleCurveSystem.prototype.setupShaders = function() {
		if (!this.material || !this.materialSrc || this.boxes.length < 2 || !this.transform) {
			return;
		}
		
		var gl = this.client.renderer.context,
			chunksVert = shaderChunks.vert,
			chunksFrag = shaderChunks.frag,
			material = this.material,
			oldProgram = this.material.program,
			program = material.program = oldProgram.isCurveGen ? oldProgram : gl.createProgram(),
			fragSrc = this.materialSrc.frag,
			vertSrc = this.materialSrc.vert,
			numBoxes = this.boxes.length,
			numColors = this.colors.length,
			numScales = this.scales.length,
			texNdx = this.texNdx,
			addColors = numColors > 1,
			addScale = numScales > 1,
			shads = hemi.utils.getShaders(this.client, material),
			fragShd = shads.fragShd,
			vertShd = shads.vertShd,
			dec = 1.0,
			maxTime = 3.0,
			time = 1.1,
			uniforms = ['sysTime', 'ptcMaxTime', 'ptcDec', 'numPtcs',
				'tension', 'ptcScales', 'ptcScaleKeys', 'minXYZ', 'maxXYZ',
				'ptcColors', 'ptcColorKeys', 'viewIT'];
		
		// Remove any previously existing uniforms that we created
		for (var i = 0, il = uniforms.length; i < il; i++) {
			var name = uniforms[i],
				param = material.uniforms[name];
			
			if (param) {
				if (name === 'ptcDec') {
					dec = param.value;
				} else if (name === 'ptcMaxTime') {
					maxTime = param.value;
				} else if (name === 'sysTime') {
					time = param.value;
				}
				
				delete material.uniforms[name];
				delete program.uniforms[name];
			}
		}
		
		// modify the vertex shader
		if (vertSrc.search('ptcInterp') < 0) {
			var vertHdr = chunksVert.header.replace(/NUM_BOXES/g, numBoxes),
				vertSprt = chunksVert.support,
				vertPreBody = chunksVert.bodySetup.replace(/NUM_BOXES/g, numBoxes);
							
			if (addColors) {
				vertHdr += chunksVert.headerColors.replace(/NUM_COLORS/g, numColors);
				vertSprt += chunksVert.supportColors.replace(/NUM_COLORS/g, numColors);
			} else {
				vertSprt += chunksVert.supportNoColors;
			}
			
			if (this.aim) {
				vertSprt += chunksVert.supportAim;
				vertPreBody += chunksVert.bodyAim;
			} else {
				vertPreBody += chunksVert.bodyNoAim;
			}
			
			if (addScale) {
				vertHdr += chunksVert.headerScales.replace(/NUM_SCALES/g, numScales);
				vertSprt += chunksVert.supportScale.replace(/NUM_SCALES/g, numScales);
				vertPreBody += chunksVert.bodyScale;
			} else {
				vertPreBody += chunksVert.bodyNoScale;
			}
			
			vertPreBody += chunksVert.bodyEnd;
			var parsedVert = hemi.utils.parseSrc(vertSrc),
				vertBody = parsedVert.body.replace(/modelViewMatrix/g, 'ptcWorldView')
					.replace(/objectMatrix/g, 'ptcWorld')
					.replace(/normalMatrix/g, 'ptcNorm');
							
			parsedVert.postSprt = vertHdr + vertSprt;
			parsedVert.preBody = vertPreBody;
			parsedVert.body = vertBody;
			vertSrc = material.vertexShader = hemi.utils.buildSrc(parsedVert);
			
			var vShader = gl.createShader(gl.VERTEX_SHADER);
			gl.shaderSource(vShader, vertSrc);
			gl.compileShader(vShader);
			gl.detachShader(program, vertShd);
			gl.attachShader(program, vShader);
		}
		
		// modify the fragment shader
		if (fragSrc.search('ptcColor') < 0) {
			var parsedFrag = hemi.utils.parseSrc(fragSrc, 'gl_FragColor'),
				fragGlob = parsedFrag.glob;
			
			parsedFrag.postSprt = chunksFrag.header;
			parsedFrag.preBody = chunksFrag.bodySetup;
			
			if (addColors) {
				if (parsedFrag.body.indexOf('diffuse') !== -1) {
					parsedFrag.body = parsedFrag.body.replace(/diffuse/g, 'ptcColor.rgb');
				} else {
					parsedFrag.body = parsedFrag.body.replace(/emissive/g, 'ptcColor.rgb');
				}
			}
			parsedFrag.body = parsedFrag.body.replace(/opacity/g, '(opacity * ptcColor.a)');
			
			fragSrc = material.fragmentShader = hemi.utils.buildSrc(parsedFrag);
			
			var fShader = gl.createShader(gl.FRAGMENT_SHADER);
			gl.shaderSource(fShader, fragSrc);
			gl.compileShader(fShader);
			gl.detachShader(program, fragShd);
			gl.attachShader(program, fShader);
		}
		
		// add the attributes and uniforms to the material
		var attributes = {
				idOffset: { type: 'v2', value: this.idOffsets, needsUpdate: true },
			},
			uniforms = {
				sysTime: { type: 'f', value: time },
				ptcMaxTime: { type: 'f', value: maxTime },
				ptcDec: { type: 'f', value: dec },
				numPtcs: { type: 'f', value: this.particles },
				tension: { type: 'f', value: (1 - this.tension) / 2 },
				minXYZ: { type: 'v3v', value: [] },
				maxXYZ: { type: 'v3v', value: [] },
				viewIT: { type: 'm4', value: new THREE.Matrix4() }
			};

		if (addColors) {
			uniforms.ptcColors = {
				type: 'v4v', value: []
			};
			uniforms.ptcColorKeys = {
				type: 'fv1', value: []
			};
		}
		if (addScale) {
			uniforms.ptcScales = {
				type: 'v3v', value: []
			};
			uniforms.ptcScaleKeys = {
				type: 'fv1', value: []
			};
		}
			
		material.uniforms = THREE.UniformsUtils.merge([material.uniforms, uniforms]);
		material.attributes = THREE.UniformsUtils.merge([material.attributes, attributes]);

		material.uniformsList = [];
		
		gl.linkProgram(program);
		
		if ( !gl.getProgramParameter( program, gl.LINK_STATUS ) ) {

			console.error( "Could not initialise shader\n" + "VALIDATE_STATUS: " 
				+ gl.getProgramParameter( program, gl.VALIDATE_STATUS ) 
				+ ", gl error [" + gl.getError() + "]" );

		}

		program.uniforms = {};
		program.attributes = {};
		program.isCurveGen = true;

		for (u in material.uniforms) {
			material.uniformsList.push([material.uniforms[u], u]);
		}
		
		// update the program to point to the uniforms and attributes
		for (var u in oldProgram.uniforms) {
			var loc = program.uniforms[u] = gl.getUniformLocation(program, u);
		}
		for (var u in uniforms) {
			program.uniforms[u] = gl.getUniformLocation(program, u);
		}
		for (var a in oldProgram.attributes) {
			var loc = program.attributes[a] = gl.getAttribLocation(program, a);
			gl.enableVertexAttribArray(loc);
		}
		for (var a in attributes) {
			var loc = program.attributes[a] = gl.getAttribLocation(program, a);
			gl.enableVertexAttribArray(loc);
		}
		
		// setup params
		this.decParam = material.uniforms.ptcDec;
		this.maxTimeParam = material.uniforms.ptcMaxTime;
		this.timeParam = material.uniforms.sysTime;
		this.viewITParam = material.uniforms.viewIT;
		
		setupBounds(material, this.boxes);
		
		var needsZ = false;
		
		for (var i = 0; i < numColors && !needsZ; i++) {
			needsZ = this.colors[i].value[3] < 1;
		}
		
		material.transparent = needsZ;
		
		if (addColors) {
			setupColors(material, this.colors);
		}
		if (addScale) {
			setupScales(material, this.scales);
		}
			
		// force rebuild of buffers
		this.transform.dynamic = true;
		this.transform.__webglInit = this.transform.__webglActive = false;
		delete this.transform.geometry.geometryGroups;
		delete this.transform.geometry.geometryGroupsList;
		this.client.scene.__objectsAdded.push(this.transform);
	};
	
	/**
	 * Render the bounding boxes which the particle system's curves run
	 * through (helpful for debugging).
	 */
	GpuParticleCurveSystem.prototype.showBoxes = function() {
		showBoxes.call(this);
	};
	
	/**
	 * Start the particle system.
	 */
	GpuParticleCurveSystem.prototype.start = function() {
		if (!this.active) {
			this.active = true;
			this.timeParam.value = 1.0;
			this.maxTimeParam.value = 1.0;
			hemi.addRenderListener(this);
		}
	};
	
	/**
	 * Stop the particle system.
	 */
	GpuParticleCurveSystem.prototype.stop = function() {
		if (this.active) {
			this.active = false;
			this.timeParam.value = 1.1;
			this.maxTimeParam.value = 3.0;
			hemi.removeRenderListener(this);
		}
	};
	
	/**
	 * Get the Octane structure for the GpuParticleCurveSystem.
     *
     * @return {Object} the Octane structure representing the
     *     GpuParticleCurveSystem
	 */
//	toOctane: function(){
//		var octane = this._super();
//		
//		octane.props.push({
//			name: 'loadConfig',
//			arg: [{
//				aim: this.aim,
//				boxes: this.boxes,
//				colorKeys: this.colors,
//				life: this.life,
//				particleCount: this.particles,
//				particleShape: this.ptcShape,
//				particleSize: this.size,
//				scaleKeys: this.scales,
//				tension: this.tension
//			}]
//		});
//		
//		return octane;
//	},
	
	/**
	 * Translate the entire particle system by the given amounts
	 * @param {number} x amount to translate in the X direction
	 * @param {number} y amount to translate in the Y direction
	 * @param {number} z amount to translate in the Z direction
	 */
	GpuParticleCurveSystem.prototype.translate = function(x, y, z) {
		for (var i = 0, il = this.boxes.length; i < il; i++) {
			var box = this.boxes[i],
				min = box.min,
				max = box.max;
			
			min[0] += x;
			max[0] += x;
			min[1] += y;
			max[1] += y;
			min[2] += z;
			max[2] += z;
		}
		setupBounds(this.material, this.boxes);
	};
	
	/**
	 * @class A GPU driven particle system that has trailing starts and stops.
	 * @extends hemi.curve.GpuParticleCurveSystem
	 * 
	 * @param {Object} opt_cfg the configuration object for the system
	 */
	var GpuParticleTrail = function(client, opt_cfg) {
		GpuParticleCurveSystem.call(this, client, opt_cfg);
		
		this.endTime = 1.0;
		this.starting = false;
		this.stopping = false;
	};
	
	GpuParticleTrail.prototype = new GpuParticleCurveSystem();
	GpuParticleTrail.prototype.constructor = GpuParticleTrail;
	
	/**
	 * Update the particles on each render.
	 * 
	 * @param {o3d.RenderEvent} e the render event
	 */
	GpuParticleTrail.prototype.onRender = function(e) {
		var delta = e.elapsedTime / this.life,
			newTime = this.timeParam.value + delta;
		
		if (newTime > this.endTime) {
			if (this.stopping) {
				this.active = false;
				this.stopping = false;
				this.maxTimeParam.value = 3.0;
				hemi.removeRenderListener(this);
				newTime = 1.1;
			} else {
				if (this.starting) {
					this.starting = false;
					this.endTime = 1.0;
					this.decParam.value = 1.0;
					this.maxTimeParam.value = 1.0;
				}
				
				while (--newTime > this.endTime) {}
			}
		}
		
		if (this.stopping) {
			this.maxTimeParam.value += delta;
		}
		
		this.timeParam.value = newTime;
		this.viewITParam.value.copy(this.client.camera.threeCamera.matrixWorld).transpose();
	};
	
	/**
	 * Resume the particle system.
	 */
	GpuParticleTrail.prototype.play = function() {
		if (!this.active) {
			if (this.starting || this.stopping || this.maxTimeParam.value === 1.0) {
				hemi.addRenderListener(this);
				this.active = true;
			} else {
				this.start();
			}
		}
	};
	
	/**
	 * Start the particle system.
	 */
	GpuParticleTrail.prototype.start = function() {
		if (this.stopping) {
			hemi.removeRenderListener(this);
			this.active = false;
			this.stopping = false;
		}
		if (!this.active) {
			this.active = true;
			this.starting = true;
			this.stopping = false;
			this.endTime = 2.0;
			this.decParam.value = 2.0;
			this.maxTimeParam.value = 2.0;
			this.timeParam.value = 1.0;
			hemi.addRenderListener(this);
		}
	};
	
	/**
	 * Stop the particle system.
	 * 
	 * @param {boolean} opt_hard optional flag to indicate a hard stop (all
	 *     particles disappear at once)
	 */
	GpuParticleTrail.prototype.stop = function(opt_hard) {
		if (this.active) {
			if (opt_hard) {
				this.endTime = -1.0;
			} else if (!this.stopping) {
				this.endTime = this.timeParam.value + 1.0;
			}
			
			this.starting = false;
			this.stopping = true;
		}
	};
	
////////////////////////////////////////////////////////////////////////////////
//                             Hemi Citizenship                               //
////////////////////////////////////////////////////////////////////////////////   

	hemi.makeCitizen(Curve, 'hemi.Curve', {
		msgs: ['hemi.start', 'hemi.stop'],
		toOctane: []
	});
	
	hemi.makeCitizen(ParticleCurveSystem, 'hemi.ParticleCurveSystem', {
		msgs: ['hemi.start', 'hemi.stop'],
		toOctane: []
	});
	
	hemi.makeCitizen(GpuParticleCurveSystem, 'hemi.GpuParticleCurveSystem', {
		msgs: ['hemi.start', 'hemi.stop'],
		toOctane: []
	});

	hemi.makeCitizen(GpuParticleTrail, 'hemi.GpuParticleTrail', {
		msgs: ['hemi.start', 'hemi.stop'],
		toOctane: []
	});
	
////////////////////////////////////////////////////////////////////////////////
//                              Private Methods                               //
////////////////////////////////////////////////////////////////////////////////   
	
				
	/**
	 * Render the bounding boxes which the curves run through, mostly for
	 * debugging purposes. 
	 * 
	 */
	function showBoxes() {		
		var trans = dbgBoxTransforms[this.transform.clientId] || [];
		
		for (var i = 0; i < this.boxes.length; i++) {
			var b = this.boxes[i],
				w = b.max[0] - b.min[0],
				h = b.max[1] - b.min[1],
				d = b.max[2] - b.min[2],
				x = b.min[0] + w/2,
				y = b.min[1] + h/2,
				z = b.min[2] + d/2,
				box = new THREE.CubeGeometry(w, h, d),
				mesh = new THREE.Mesh(box, dbBoxMat);
			
			mesh.position.addSelf(new THREE.Vector3(x, y, z));
			this.transform.add(mesh);
			trans.push(mesh);
		}
		
		dbgBoxTransforms[this.transform.clientId] = trans;
	};
	
	/**
	 * Remove the bounding boxes from view. If a parent transform is given, only
	 * the bounding boxes under it will be removed. Otherwise all boxes will be
	 * removed.
	 */
	function hideBoxes() {
		for (var id in dbgBoxTransforms) {
			var trans = dbgBoxTransforms[id] || [];
			
			for (var i = 0; i < trans.length; i++) {
				var tran = trans[i];
				
				this.transform.remove(tran);
			}
			
			delete dbgBoxTransforms[id];
		}
	};
	
////////////////////////////////////////////////////////////////////////////////
//                              Utility Methods                               //
////////////////////////////////////////////////////////////////////////////////

	/**
	 * Render a 3D representation of a curve.
	 *
	 * @param {number[3][]} points array of points (not waypoints)
	 * @param {Object} config configuration describing how the curve should look
	 */
	function drawCurve(points, config) {
//		if (!this.dbgLineMat) {
//			this.dbgLineMat = this.newMaterial('phong', false);
//			this.dbgLineMat.getParam('lightWorldPos').bind(hemi.world.camera.light.position);
//		}
//		
//		var eShow = (config.edges == null) ? true : config.edges,
//			eSize = config.edgeSize || 1,
//			eColor = config.edgeColor || [0.5,0,0,1],
//			jShow = (config.joints == null) ? true : config.joints,
//			jSize = config.jointSize || 1,
//			jColor = config.jointColor,
//			crvTransform = this.pack.createObject('Transform');
//		
//		for (var i = 0; i < points.length; i++) {
//			if(jShow) {
//				var transform = this.pack.createObject('Transform'),
//					joint = hemi.core.primitives.createSphere(this.pack,
//						this.dbgLineMat, jSize, 20, 20);
//				
//				transform.parent = crvTransform;
//				transform.addShape(joint);
//				transform.translate(points[i]);
//				
//				if (jColor) {
//					var param = transform.createParam('diffuse', 'o3d.ParamFloat4');
//					param.value = jColor;
//				}
//			}
//			if (eShow && i < (points.length - 1)) {
//				var edgeTran = this.drawLine(points[i], points[i+1], eSize, eColor);
//				edgeTran.parent = crvTransform;
//			}
//		}
//		
//		crvTransform.parent = hemi.core.client.root;
//		this.dbgLineTransforms.push(crvTransform);
	};
	
	/**
	 * Draw a line connecting two points.
	 *
	 * @param {number[]} p0 The first point
	 * @param {number[]} p1 The second point
	 * @param {number} opt_size Thickness of the line
	 * @param {number[]} opt_color Color of the line
	 * @return {o3d.Transform} the Transform containing the line shape
	 */
	function drawLine(p0, p1, opt_size, opt_color) {
//		if (!this.dbgLineMat) {
//			this.dbgLineMat = this.newMaterial('phong', false);
//			this.dbgLineMat.getParam('lightWorldPos').bind(hemi.world.camera.light.position);
//		}
//		
//		var size = opt_size || 1,
//			dist = hemi.core.math.distance(p0,p1),
//			midpoint = [ (p0[0]+p1[0])/2, (p0[1]+p1[1])/2, (p0[2]+p1[2])/2 ],
//			line = hemi.core.primitives.createCylinder(this.pack,
//				this.dbgLineMat, size, dist, 3, 1),
//			transform = this.pack.createObject('Transform');
//		
//		transform.addShape(line);
//		transform.translate(midpoint);
//		transform = hemi.utils.pointYAt(transform,midpoint,p0);
//		
//		if (opt_color) {
//			var param = transform.createParam('diffuse', 'o3d.ParamFloat4');
//			param.value = opt_color;
//		}
//		
//		return transform;
	};
	
	/**
	 * Remove the given curve line Transform, its shapes, and its children.
	 * 
	 * @param {o3d.Transform} opt_trans optional Transform to clean up
	 */
	function hideCurves(opt_trans) {
//		if (opt_trans) {
//			var children = opt_trans.children,
//				shapes = opt_trans.shapes;
//			
//			for (var i = 0; i < children.length; i++) {
//				this.hideCurves(children[i]);
//			}
//			for (var i = 0; i < shapes.length; i++) {
//				var shape = shapes[i];
//				opt_trans.removeShape(shape);
//				this.pack.removeObject(shape);
//			}
//			
//			opt_trans.parent = null;
//			this.pack.removeObject(opt_trans);
//		} else {
//			for (var i = 0; i < this.dbgLineTransforms.length; i++) {
//				this.hideCurves(this.dbgLineTransforms[i]);
//			}
//			
//			this.dbgLineTransforms = [];
//		}
	};  
	
	/*
	 * Take the existing vertex buffer in the given primitive and copy the data
	 * once for each of the desired number of particles. 
	 * 
	 * @param {THREE.Geometry} geometry the geoemtry to modify
	 * @param {number} numParticles the number of particles to create vertex
	 *     data for
	 */
	function modifyGeometry(geometry, numParticles) {
		var verts = geometry.vertices,
			faces = geometry.faces
			faceVertexUvs = geometry.faceVertexUvs,
			numVerts = verts.length,
			numFaces = faces.length,
			ids = [],
			offsets = [],
			idOffsets = [];
				
		for (var j = 0; j < numVerts; j++) {
			ids.push(0);
			offsets.push(0);
			idOffsets.push(new THREE.Vector2());
		}
		
		for (var i = 1; i < numParticles; i++) {
			var vertOffset = i * numVerts,
				timeOffset = i / numParticles,
				newVerts = [],
				newFaces = [];
				
			for (var j = 0; j < numVerts; j++) {
				ids.push(i);
				offsets.push(timeOffset);
				idOffsets.push(new THREE.Vector2(i, timeOffset));
				var vert = verts[j].position,
					newVert = new THREE.Vector3(vert.x, vert.y, vert.z);
				newVerts.push(new THREE.Vertex(newVert));
			}
			
			for (var j = 0; j < numFaces; j++) {
				var face = faces[j],
					newFace = null;
				
				if (face instanceof THREE.Face3) {
					newFace = new THREE.Face3(face.a + vertOffset,
						face.b + vertOffset,
						face.c + vertOffset,
						null, null, face.material);
				}
				else {
					newFace = new THREE.Face4(face.a + vertOffset,
						face.b + vertOffset,
						face.c + vertOffset,
						face.d + vertOffset,
						null, null, face.material);
				}
				newFaces.push(newFace);
			}
			
			// dupe the vertices
			geometry.vertices = geometry.vertices.concat(newVerts);
		
			// dupe the faces	
			geometry.faces = geometry.faces.concat(newFaces);
			
			// dupe the uvs
			geometry.faceVertexUvs = geometry.faceVertexUvs.concat(faceVertexUvs);
		}

		geometry.computeCentroids();
		geometry.computeFaceNormals();
		
		return {
			ids: ids,
			offsets: offsets,
			idOffsets: idOffsets
		}
	};
	
	/**
	 * Create a new material for a hemi particle curve to use.
	 * 
	 * @param {string} opt_type optional shader type to use (defaults to phong)
	 * @param {boolean} opt_trans optional flag indicating if material should
	 *     support transparency (defaults to true)
	 * @return {THREE.Material} the created material
	 */
	function newMaterial(opt_type, opt_trans) {
		var params = {
				color: 0xff0000,
				opacity: 1,
				transparent: opt_trans == null ? true : opt_trans
			},
			mat;
		
		switch (opt_type) {
			case 'lambert':
				mat = new THREE.MeshLambertMaterial(params);
				break;
			default:
				mat = new THREE.MeshPhongMaterial(params);
				break;
		}
		
		return mat;
	};
	
	/**
	 * Generate a random point within a bounding box
	 *
	 * @param {number[]} min Minimum point of the bounding box
	 * @param {number[]} max Maximum point of the bounding box
	 * @return {number[]} Randomly generated point
	 */
	function randomPoint(min, max) {
		var xi = Math.random();
		var yi = Math.random();
		var zi = Math.random();
		var x = xi*min[0] + (1-xi)*max[0];
		var y = yi*min[1] + (1-yi)*max[1];
		var z = zi*min[2] + (1-zi)*max[2];
		return [x,y,z];
	};
	
	/*
	 * Set the parameters for the given Material so that it supports a curve
	 * through the given bounding boxes.
	 * 
	 * @param {o3d.Material} material material to set parameters for
	 * @param {hemi.curve.Box[]} boxes array of min and max XYZ coordinates
	 */
	function setupBounds(material, boxes) {
		var minParam = material.uniforms.minXYZ,
			maxParam = material.uniforms.maxXYZ;
			
		minParam._array = new Float32Array(3 * boxes.length);
		maxParam._array = new Float32Array(3 * boxes.length);
				
		for (var i = 0, il = boxes.length; i < il; ++i) {
			var box = boxes[i],
				min = box.min,
				max = box.max;
						
			minParam.value[i] = new THREE.Vector3(min[0], min[1], min[2]);
			maxParam.value[i] = new THREE.Vector3(max[0], max[1], max[2]);
		}
	};
	
	/*
	 * Set the parameters for the given Material so that it adds a color ramp to
	 * the particles using it.
	 * 
	 * @param {o3d.Material} material material to set parameters for
	 * @param {Object[]} colors array of RGBA color values and keys
	 */
	function setupColors(material, colors) {
		var clrParam = material.uniforms.ptcColors,
			keyParam = material.uniforms.ptcColorKeys;
		
		clrParam._array = new Float32Array(4 * colors.length);
		
		for (var i = 0, il = colors.length; i < il; ++i) {
			var obj = colors[i],
				offset = i * 4;
			
			clrParam.value[i] = new THREE.Vector4(obj.value[0], obj.value[1], 
				obj.value[2], obj.value[3]);
			keyParam.value[i] = obj.key;
		}
	};
	
	/*
	 * Set the parameters for the given Material so that it adds a scale ramp to
	 * the particles using it.
	 * 
	 * @param {o3d.Material} material material to set parameters for
	 * @param {Object[]} scales array of XYZ scale values and keys
	 */
	function setupScales(material, scales) {
		var sclParam = material.uniforms.ptcScales,
			keyParam = material.uniforms.ptcScaleKeys;
		
		sclParam._array = new Float32Array(3 * scales.length);
		
		for (var i = 0, il = scales.length; i < il; ++i) {
			var obj = scales[i];
			
			sclParam.value[i] = new THREE.Vector3(obj.value[0], obj.value[1], 
				obj.value[2]);
			keyParam.value[i] = obj.key;
		}
	};
	
	return hemi;
})(hemi || {});
