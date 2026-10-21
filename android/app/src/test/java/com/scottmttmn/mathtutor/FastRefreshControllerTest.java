package com.scottmttmn.mathtutor;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FastRefreshControllerTest {
    private int entries;
    private boolean supported = true;
    private int exits;
    private final FastRefreshController refresh = new FastRefreshController(
        () -> { entries++; return supported; }, () -> exits++
    );

    @Test
    public void anEditingModeEntersAndLeavesOnlyOnce() {
        for (int i = 0; i < 20; i++) assertTrue(refresh.begin());
        assertEquals(1, entries);
        assertEquals(0, exits);
        refresh.end();
        refresh.end();
        assertEquals(1, exits);
        assertFalse(refresh.isActive());
    }

    @Test
    public void penContactCancelsFastModeWithoutARefreshDuringTheStroke() {
        refresh.begin();
        refresh.beginStroke();
        assertEquals(1, exits);
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
        refresh.end();
        refresh.reset();
        assertEquals(0, exits);
    }

    @Test
    public void lifecycleResetReleasesFastModeWithoutAVisibleCleanupRefresh() {
        refresh.begin();
        refresh.reset();
        refresh.reset();
        assertEquals(1, exits);
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
