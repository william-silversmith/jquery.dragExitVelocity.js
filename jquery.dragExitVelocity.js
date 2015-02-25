/* dragExitVelocity
 *
 * Usage: 
 *
 *     // Chain version (normal jQuery semantics)
 *     $(document)
 * 			.dragExitVelocity(100, function (velocity) { ... })
 *			.click(...)
 *
 *    // Promise version (distinguished by lack of callback)
 *     $(document).dragExitVelocity(100) // 100 msec averating window
 *			.done(function (velocity) { ... });
 *
 *
 * velocity: { Vx: float, Vy: float }, units are pixels / second
 *
 * Description:
 *
 * Implements a friendly way to get an accurate exit velocity
 * from a click and drag. Sometimes you'll want to perform
 * some kind of animation once the user releases the mouse button
 * depending on the pointer velocity.
 *
 * This can be achieved in a naive way and in a more sophisticated
 * way. 
 *
 * Since Javascript doesn't provide a way to access where the mouse
 * pointer currently is, you must rely on the mousemove event.
 * (https://stackoverflow.com/questions/7790725/javascript-track-mouse-position)
 *
 * Here's a naive approach:
 *
 * 		pos0 = getpos()
 * 		elapsed = 0
 * 		start ticking
 * 		every mouse move: pos_final = new position
 * 		every tick: pos0 = posf, elapsed = 0
 * 		onmouseup: 
 *    		stop ticking
 *    		return (pos_final - pos0) / time since last datum
 * 
 * The problem is that if you release the button right after a tick,
 * the results will not be numerically stable. e.g. user releases
 * button 20msec after reset, 2px away (it's common to stop moving
 * right as you release the mouse button). The mouse was actually moving at 
 * 1000px / sec prior to stopping, but the measured velocity is 100px /sec.
 *
 * This library solves this problem by recording a history
 * of mouse moves so that when the user releases the button, 
 * we can simply look back in time to see where the mouse was
 * at the beginning of the time window.
 *
 * Required:
 *   jQuery
 *
 * Author: William Silversmith
 * Date: Feb. 25, 2015
 */

;(function ($, undefined) {
	"use strict";

	$.fn.dragExitVelocity = function (msec, fn) {
		var target = $(this);

		var promise =  $.Deferred();

		// On my Macbook Pro, on Chrome 40.0, seems like fastest 
		// mouse move events are about 10 msec apart. Allocate
		// a few safety factors worth of buffer space.
		var len = Math.round(msec / 10) * 3;  

		var buffer = new Array(len); // keep a record of mouse positions over a period of time

		var evtclass = "dragExitVelocity" + (Math.random() * 1000000);

		var i = 0;
		$(target).on('mousemove.' + evtclass, function (e) {
			var datum = positionFromEvent(target, e);
			datum.time = new Date();
			buffer[i] = datum;
			i = (i + 1) % len;
		});

		$(target).one('mouseup', function () {
			$(target).off('mousemove.' + evtclass);
			
			var velocity = computeVelocity(buffer, i, msec);
			promise.resolve(velocity);
		});

		// Still allow this function to be chained
		// even though promises are often better.
		if (fn) {
			promise.done(fn);
			return target;
		}

		return promise;
	};

	function positionFromEvent (elem, evt) {
		var offset = { x: 0, y: 0 };

		var elem_offset = $(elem).offset() || { left: 0, top: 0 };

		if (!(evt.offsetX || evt.offsetY)) {
			offset.x = evt.pageX - elem_offset.left;
			offset.y = evt.pageY - elem_offset.top;
		} 
		else {
			offset.x = evt.offsetX + ($(evt.target).offset().left - elem_offset.left);
			offset.y = evt.offsetY + ($(evt.target).offset().top - elem_offset.top);
		}

		return offset;
	}

	function computeVelocity (buffer, i, msec) {
		// To correct for a long immobile cursor
		// Add the previous position at the current
		// time stamp.
		i = (i === 0) ? buffer.length : i;
		buffer[i] = $.extend({}, buffer[i - 1]);
		buffer[i].time = new Date();

		// Discard unused buffer space
		buffer = buffer.filter(function (x) { return x !== undefined });

		if (buffer.length === 0) {
			return {
				Vx: 0,
				Vy: 0,
			};
		}

		// Sort by time desc
		buffer.sort(function (a, b) {
			return (a.time === b.time)
				? 0
				: ((a.time > b.time) ? -1 : 1);
		});

		// Find the datapoint closest to the start
		// of the time window rounding towards now
		var mostrecent = buffer[0];
		var mintime = mostrecent;

		var j;
		for (j = 1; j < buffer.length; j++) {
			if (buffer[j].time < (mostrecent.time - msec)) {
				break;
			}

			if (buffer[j].time < mintime.time) {
				mintime = buffer[j];
				continue;
			}
		}

		// only interpolate if trailing is within a plausible resolution
		// I'm going to arbitrarily say that you can linearize within 50 msec.
		mintime = interpolateTrailingEdge(buffer, j - 1, msec, 50); 

		// Now we can simply compute velocities in pixels per msec
		var elapsed = mostrecent.time - mintime.time;

		if (elapsed === 0) {
			return {
				Vx: 0,
				Vy: 0,
			};
		}
		
		// invert y b/c of inverted "top" coord system
		return {
			Vx: (mostrecent.x - mintime.x) / elapsed * 1000,
			Vy: -(mostrecent.y - mintime.y) / elapsed * 1000, 
		};
	}

	// Since we're not likely to land exactly on 
	// msec, if the previous datapoint was within a reasonable distance
	// of the border (let's say 50 msec), do a linear interpolation
	function interpolateTrailingEdge (buffer, j, msec, interpolation_threshold) {
		var mostrecent = buffer[0];
		var mintime = buffer[j];
		var trailing = buffer[j + 1];

		if (trailing 
			&& (mintime.time - trailing.time) < interpolation_threshold) {

			var tmsec = mostrecent.time - msec;
			var miniwindow = mintime.time - trailing.time;
			var w1 = 1 - Math.abs(mintime.time - tmsec) / miniwindow;
			var w2 = 1 - Math.abs(tmsec - trailing.time) / miniwindow;

			mintime.x = w1 * mintime.x + w2 * trailing.x;
			mintime.y = w1 * mintime.y + w2 * trailing.y;
			mintime.time = w1 * mintime.time + w2 * trailing.time;
		}

		return mintime;
	}
})(jQuery);


/*

The MIT License (MIT)

Copyright (c) 2015 William Silversmith

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/


