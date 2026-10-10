/** Native draw replay only; all command geometry and timing originate in Rust. */
export const MV_HEART_DRAW_SOURCE = String.raw`
function mvHeartDraw(target, command, assets, scratch, make, scratchTarget) {
    target.save();
    try {
      if (command.kind === 'preparedPatch') { assets.preparedPatch(command,target); return; }
      if (command.kind === 'grayPixels') { mvEmberGrayPixels(target,command); return; }
      if (command.kind === 'alphaPixels') { mvEmberPixels(target,command,true); return; }
      if (command.kind === 'filteredRect') { mvEmberFilteredRect(target,command); return; }
      if (command.clip) {
        mvEmberTransform(target,command.clip);
        mvEmberPath(target,command.clip.path); target.clip('nonzero');
      }
      mvEmberTransform(target,command);
      if (command.kind === 'path' || command.kind === 'circleBatch') {
        if (command.kind === 'path') mvEmberPath(target,command.path);
        else mvEmberCirclePath(target,command.circles);
        for (const spec of command.paints) mvEmberPaint(target,spec);
      } else if (command.kind === 'filteredPath') {
        if (!scratchTarget) throw Error('Heart filtered path requires an admitted scratch target');
        mvHeartFilteredPath(target,command);
      }
      else if (command.kind === 'shadowPath') mvHeartShadowPath(target,command);
      else if (command.kind === 'preparedImage') mvHeartPreparedImage(target,command,assets);
      else if (command.kind === 'rect') mvEmberPaint(target,command.paint,command.rect);
      else if (command.kind === 'gradientRect') mvGradientRect(target,command);
      else if (command.kind === 'rectBatch') mvEmberRectBatch(target,command);
      else if (command.kind === 'grain') mvEmberGrain(target,command,make);
      else if (command.kind === 'text' || command.kind === 'textStroke') mvEmberText(target,command,assets);
      else if (command.kind === 'image') {
        if (assets.descriptor(command.image).kind !== 'image') throw Error('Heart image requires a declared image');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        target.imageSmoothingEnabled = command.smoothing; target.imageSmoothingQuality = command.smoothingQuality;
        if (command.sourceRect) target.drawImage(assets.image(command.image),...command.sourceRect,...command.destinationRect);
        else target.drawImage(assets.image(command.image),...command.destinationRect);
      } else if (command.kind === 'surfacePatternRect') {
        const source = scratch.get(command.surface);
        if (!source) throw Error('Pattern requires an earlier completed live Heart scratch surface');
        const pattern = target.createPattern(source,'repeat');
        if (!pattern) throw Error('Native surface pattern unavailable');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        target.imageSmoothingEnabled = command.smoothing; target.imageSmoothingQuality = command.smoothingQuality;
        target.fillStyle = pattern; target.fillRect(...command.rect);
      } else if (command.kind === 'blit') {
        const source = scratch.get(command.surface);
        if (!source) throw Error('Heart blit requires an earlier scratch surface');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        if (command.raster) {
          const r = command.raster;
          target.filter = mvOrderedBlitFilter(r);
          target.imageSmoothingEnabled = r.smoothing; target.imageSmoothingQuality = r.smoothingQuality;
        }
        target.drawImage(source,...command.sourceRect,...command.destinationRect);
      } else throw Error('Unsupported Heart draw command');
    } finally { target.restore(); }
  };
`;
