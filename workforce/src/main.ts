// ВОССТАНОВЛЕНА ПРОВЕРКА КОНФЛИКТОВ СМЕНЫ МЕЖДУ МЕСЯЦАМИ
  renderBrigadeSchedule(calc, data, (newShift: number) => {
    const conflicts: string[] = [];
    data.months.forEach((m, idx) => {
      const sched = calc.universalSchedules[idx];
      if (sched.isExtendedShift && sched.trueNeededShift > newShift) {
        conflicts.push(`${m} (нужно ${sched.trueNeededShift}ч)`);
      }
    });

    const applyFn = () => {
      const extInput = document.getElementById("inputExtendedShiftHours") as HTMLInputElement | null;
      if (extInput) extInput.value = String(newShift);
      data.settings.extendedShiftHours = newShift;
      data.settings.fNomExtended = calcExtendedFNom(data.settings.fNom, newShift, data.settings.shiftHoursStandard);
      data.settings.fEffExtended = calcFEff(data.settings.fNomExtended, data.settings.reserveOffPercent);
      storageService.saveState(state);
      renderAll();
    };

    if (conflicts.length > 0) {
      modalSystem.confirm(
        "Проверьте другие периоды",
        `Вы применяете смену <strong>${newShift}ч</strong>. Но в других месяцах усиленного режима требуется больше: ${conflicts.join(", ")}. Если применить ${newShift}ч как общий предел — эти месяцы окажутся недогружены. Применить всё равно?`,
        applyFn
      );
    } else {
      applyFn();
    }
  });
