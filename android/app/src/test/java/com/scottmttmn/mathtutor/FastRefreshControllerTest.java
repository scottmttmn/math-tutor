package com.scottmttmn.mathtutor;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class FastRefreshControllerTest {
    private int entries;
    private boolean supported = true;
    private final List<Boolean> exits = new ArrayList<>();
    private final FastRefreshController refresh = new FastRefreshController(
        () -> { entries++; return supported; }, exits::add
    );

    @Test
    public void aGestureEntersOnceAndHasOneSettledRepaint() {
        for (int i = 0; i < 20; i++) assertTrue(refresh.begin());
        assertEquals(1, entries);
        assertTrue(exits.isEmpty());
        refresh.end(true);
        refresh.end(true);
        assertEquals(List.of(true), exits);
        assertFalse(refresh.isActive());
    }

    @Test
    public void penContactCancelsFastModeWithoutARefreshDuringTheStroke() {
        refresh.begin();
        refresh.beginStroke();
        assertEquals(List.of(false), exits);
        assertFalse(refresh.begin());
        assertEquals(1, entries);
        refresh.endStroke();
        assertTrue(refresh.begin());
        assertEquals(2, entries);
    }

    @Test
    public void unsupportedDevicesDoNotAcquireFastModeOrRequestCleanup() {
        supported = false;
        assertFalse(refresh.begin());
        refresh.end(true);
        refresh.reset();
        assertTrue(exits.isEmpty());
    }

    @Test
    public void lifecycleResetReleasesFastModeWithoutAVisibleCleanupRefresh() {
        refresh.begin();
        refresh.reset();
        refresh.reset();
        assertEquals(List.of(false), exits);
        assertFalse(refresh.isActive());
    }

    @Test
    public void reopeningAfterAnInterruptedPenStrokeCanUseFastModeAgain() {
        refresh.beginStroke();
        assertFalse(refresh.begin());
        refresh.reset();
        assertTrue(refresh.begin());
    }
}
