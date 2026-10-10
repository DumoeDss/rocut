/** Direct native filtered stroke/fill, never a shadow or postprocessed bitmap. */
export const MV_HEART_FILTERED_SOURCE = String.raw`
function mvHeartFilteredPath(ctx, command) {
  if (command.blurPx !== 10 || command.clip ||
      !Array.isArray(command.transform) || command.transform.length !== 6 ||
      command.transform.some((v,i) => v !== [1,0,0,1,0,0][i]) ||
      !Array.isArray(command.operations) || command.operations.length !== 0)
    throw Error('Invalid Heart native filtered path');
  ctx.filter = 'blur(' + command.blurPx + 'px)';
  mvEmberPath(ctx,command.path);
  for (const paint of command.paints) mvEmberPaint(ctx,paint);
}
`;
