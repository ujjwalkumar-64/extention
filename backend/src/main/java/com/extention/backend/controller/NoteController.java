package com.extention.backend.controller;


import com.extention.backend.entity.Note;
import com.extention.backend.request.CreateNoteRequest;
import com.extention.backend.service.serviceImpl.NoteServiceImpl;

import com.extention.backend.utils.AuthUserUtil;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/notes")
@RequiredArgsConstructor
public class NoteController {

    private final NoteServiceImpl noteService;

    @PostMapping
    public ResponseEntity<CreateNoteResponse> create(@RequestBody CreateNoteRequest req) {
        String username = AuthUserUtil.requireUsername();
        Note note = noteService.saveCategorized(username, req.source(), req.content());
        return ResponseEntity.ok(new CreateNoteResponse(note.getId(), true, note.getCategoriesJson()));
    }

    @GetMapping
    public ResponseEntity<List<Note>> list() {
        String username = AuthUserUtil.requireUsername();
        return ResponseEntity.ok(noteService.list(username));
    }


    public record CreateNoteResponse(Long id, boolean ok, String categoriesJson) {}
}