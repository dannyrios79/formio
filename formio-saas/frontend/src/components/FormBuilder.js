import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormBuilder as FormioFormBuilder, Form } from '@formio/react';
import { supabaseDB } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { toast, ToastContainer } from 'react-toastify';

// Import Form.io full styles - this includes wizard support
import 'formiojs/dist/formio.full.min.css';
import 'react-toastify/dist/ReactToastify.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './FormBuilder.css';
import './FormBuilderIcons.css';

// Import the full Formio library for builder support
import 'formiojs/dist/formio.full.min.js';
const Formio = window.Formio;

function FormBuilder() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const builderContainerRef = useRef(null);
  const builderInstanceRef = useRef(null);
  
  // Track display mode separately
  const [displayMode, setDisplayMode] = useState('form');
  
  // Form state
  const [form, setForm] = useState({
    title: 'New Form',
    name: 'newForm', 
    path: 'newform',
    display: 'form',
    type: 'form',
    components: [],
    settings: {},
    _id: formId || undefined
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [formUrl, setFormUrl] = useState('');
  const [testData, setTestData] = useState({});

  // Load form if editing
  const loadForm = useCallback(async () => {
    if (!formId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabaseDB.forms.get(formId);
      
      if (error) {
        console.error('Error loading form:', error);
        toast.error('Error loading form');
        navigate('/forms');
        return;
      }
      
      if (data) {
        console.log('Loaded form data:', data);
        
        const formData = {
          title: data.name || 'Untitled Form',
          name: data.name || 'untitled',
          path: data.name ? data.name.toLowerCase().replace(/\s+/g, '-') : 'untitled',
          display: data.display_type || 'form',
          type: 'form',
          components: data.schema?.components || [],
          settings: data.settings || {},
          _id: data.id
        };
        
        setForm(formData);
        setDisplayMode(data.display_type || 'form');
        
        if (data.is_public && data.form_url) {
          setFormUrl(data.form_url);
        }
      }
    } catch (err) {
      console.error('Error loading form:', err);
      toast.error('Failed to load form');
    } finally {
      setLoading(false);
    }
  }, [formId, navigate]);

  // Load form on mount
  useEffect(() => {
    loadForm();
  }, [loadForm]);

  // Handle display mode change
  const handleDisplayChange = (e) => {
    const newMode = e.target.value;
    setDisplayMode(newMode);
    
    // Update form display property
    setForm(prevForm => ({
      ...prevForm,
      display: newMode
    }));
    
    // Rebuild the builder with new mode
    if (builderInstanceRef.current) {
      builderInstanceRef.current.destroy();
      builderInstanceRef.current = null;
    }
  };

  // Handle form changes from builder
  const handleFormChange = (schema) => {
    console.log('Form changed:', schema);
    setForm(prevForm => ({
      ...prevForm,
      ...schema,
      title: prevForm.title // Preserve title
    }));
  };

  // Handle test submission
  const handleSubmitTest = (submission) => {
    console.log('Test submission:', submission);
    setTestData(submission.data);
    toast.success('Form submitted successfully (test mode)');
  };

  // Toggle publish status
  const togglePublish = async () => {
    if (!formId) {
      toast.error('Please save the form first');
      return;
    }

    try {
      const isPublic = !!formUrl;
      const newUrl = isPublic ? null : `${window.location.origin}/public/form/${formId}`;
      
      const { error } = await supabaseDB.forms.update(formId, {
        is_public: !isPublic,
        form_url: newUrl
      });

      if (error) {
        toast.error('Error updating form status');
        return;
      }

      setFormUrl(newUrl);
      toast.success(isPublic ? 'Form unpublished' : 'Form published successfully!');
    } catch (err) {
      console.error('Error toggling publish:', err);
      toast.error('Failed to update form status');
    }
  };

  // Copy URL to clipboard
  const copyToClipboard = () => {
    if (formUrl) {
      navigator.clipboard.writeText(formUrl);
      toast.success('URL copied to clipboard!');
    }
  };

  // Save form
  const saveForm = async () => {
    if (!form.title || form.title.trim() === '') {
      toast.error('Please enter a form title');
      return;
    }

    setSaving(true);
    try {
      const formData = {
        name: form.title,
        description: form.description || '',
        display_type: displayMode,
        schema: {
          display: displayMode,
          type: form.type,
          components: form.components,
          settings: form.settings || {}
        },
        settings: {
          ...form.settings
        },
        is_public: !!formUrl,
        created_by: user?.id
      };
      
      console.log('Saving form data:', formData);
      
      let result;
      if (formId) {
        result = await supabaseDB.forms.update(formId, formData);
      } else {
        result = await supabaseDB.forms.create(formData);
      }

      if (result.error) {
        console.error('Save error:', result.error);
        toast.error('Error saving form: ' + result.error.message);
      } else {
        toast.success('Form saved successfully!');
        if (!formId && result.data?.id) {
          navigate(`/builder/${result.data.id}`);
        }
      }
    } catch (err) {
      console.error('Error saving form:', err);
      toast.error('Failed to save form');
    } finally {
      setSaving(false);
    }
  };

  // Initialize Form.io builder
  useEffect(() => {
    // Only initialize if we have a container and not in preview mode
    if (!builderContainerRef.current || showPreview) {
      return;
    }

    // Clean up any existing builder
    if (builderInstanceRef.current) {
      try {
        builderInstanceRef.current.destroy();
      } catch (e) {
        console.error('Error destroying builder:', e);
      }
      builderInstanceRef.current = null;
    }

    // Make sure Formio is available
    if (!window.Formio) {
      console.error('Formio not loaded');
      return;
    }

    // Clear the container
    builderContainerRef.current.innerHTML = '';
    
    // FIX: Patch global event handlers to prevent slice errors on tab clicks
    const patchEventHandlers = () => {
      // Override addEventListener to intercept problematic handlers
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        // Wrap the listener to catch errors
        const safeListener = function(event) {
          try {
            // Check if this is a Bootstrap accordion/tab button
            if (type === 'click' && (
              this.hasAttribute('data-bs-toggle') || 
              this.hasAttribute('aria-controls') ||
              this.classList.contains('builder-group-button')
            )) {
              // Ensure required properties exist
              if (!window.Formio.forms) window.Formio.forms = {};
              if (!window.Formio.cache) window.Formio.cache = {};
            }
            
            // Call original listener
            if (typeof listener === 'function') {
              return listener.call(this, event);
            } else if (listener && typeof listener.handleEvent === 'function') {
              return listener.handleEvent.call(listener, event);
            }
          } catch (e) {
            // Only log actual errors, not the slice error
            if (!e.message || !e.message.includes('slice')) {
              console.warn('Event handler error caught:', e);
            }
            // Prevent error propagation
            event.stopPropagation();
          }
        };
        
        // Call original with wrapped listener
        return originalAddEventListener.call(this, type, safeListener, options);
      };
    };
    
    // Apply the patch
    patchEventHandlers();

    // Disable ALL API calls - prevent Form.io from trying to load resources
    window.Formio.setBaseUrl('');
    window.Formio.setProjectUrl('');
    window.Formio.setToken(null);
    
    // Override the Formio.makeRequest to prevent any external calls and errors
    if (!window.Formio._originalMakeRequest) {
      window.Formio._originalMakeRequest = window.Formio.makeRequest;
    }
    
    window.Formio.makeRequest = function(...args) {
      // Block all external API calls
      if (args[0] && args[0].url) {
        // Return empty responses for resource/form requests
        if (args[0].url.includes('?type=resource') || 
            args[0].url.includes('?type=form') ||
            args[0].url.includes('/form') ||
            args[0].url.includes('/resource')) {
          return Promise.resolve([]);
        }
      }
      // Block all other external requests
      return Promise.resolve([]);
    };
    
    // FIX: Override Formio.use to prevent plugin errors
    if (window.Formio.use) {
      window.Formio.use = function() {
        // Do nothing - prevent plugin loading errors
        return window.Formio;
      };
    }
    
    // FIX: Patch the prototype to prevent slice errors
    if (window.Formio.builders && window.Formio.builders.Builders) {
      const BuildersProto = window.Formio.builders.Builders.prototype;
      if (BuildersProto) {
        // Override any method that might cause slice errors
        const originalSetBuilder = BuildersProto.setBuilder;
        if (originalSetBuilder) {
          BuildersProto.setBuilder = function(name, builder) {
            try {
              if (!name || !builder) return;
              return originalSetBuilder.call(this, name, builder);
            } catch (e) {
              console.warn('Caught setBuilder error:', e);
              return null;
            }
          };
        }
      }
    }
    
    // FIX: Prevent errors in form path processing
    if (window.Formio.prototype) {
      const originalLoad = window.Formio.prototype.load;
      if (originalLoad) {
        window.Formio.prototype.load = function() {
          try {
            // Ensure this.path exists before processing
            if (!this.path) {
              this.path = '';
            }
            return originalLoad.apply(this, arguments);
          } catch (e) {
            console.warn('Caught load error:', e);
            return Promise.resolve({});
          }
        };
      }
    }
    
    // Also override loadForms to prevent errors
    if (window.Formio.builder) {
      const originalBuilder = window.Formio.builder;
      window.Formio.builder = function(element, form, options) {
        // Ensure no resource loading
        const safeOptions = {
          ...options,
          builder: {
            ...options.builder,
            resource: false,
            form: false
          }
        };
        return originalBuilder.call(this, element, form, safeOptions);
      };
    }

    // Create form structure based on display mode
    const builderForm = displayMode === 'wizard' ? {
      display: 'wizard',
      type: 'form',
      title: form.title,
      name: form.name,
      path: form.path,
      components: form.components && form.components.length > 0 ? form.components : [
        {
          type: 'panel',
          title: 'Page 1',
          key: 'page1',
          components: []
        }
      ]
    } : {
      display: 'form',
      type: 'form',
      title: form.title,
      name: form.name,
      path: form.path,
      components: form.components || []
    };

    // Builder options - disable resource loading
    const builderOptions = {
      noNewEdit: false,  // Allow auto-edit when adding new components
      noDefaultSubmitButton: displayMode === 'wizard',
      builder: {
        resource: false,  // Disable resource components
        basic: {
          title: 'Basic',
          weight: 0,
          default: true,
          components: {
            textfield: true,
            textarea: true,
            number: true,
            password: true,
            checkbox: true,
            selectboxes: true,
            select: true,
            radio: true,
            button: true
          }
        },
        advanced: {
          title: 'Advanced',
          weight: 10,
          components: {
            email: true,
            phoneNumber: true,
            tags: true,
            address: true,
            datetime: true,
            day: true,
            time: true,
            currency: true,
            signature: true,
            file: true,
            url: true
          }
        },
        layout: {
          title: 'Layout',
          weight: 20,
          components: {
            panel: displayMode === 'form',
            table: true,
            tabs: true,
            well: true,
            columns: true,
            fieldset: true,
            content: true,
            htmlelement: true
          }
        },
        data: {
          title: 'Data',
          weight: 30,
          components: {
            hidden: true,
            container: true,
            datagrid: true,
            editgrid: true
          }
        }
      }
    };

    // Create builder
    const builderPromise = window.Formio.builder(builderContainerRef.current, builderForm, builderOptions);
    
    builderPromise.then((builder) => {
      console.log('Builder initialized:', displayMode);
      builderInstanceRef.current = builder;
      
      // FIX: Add accordion functionality to group headers (only one open at a time, always keep one open)
      setTimeout(() => {
        // Ensure Basic section is open by default
        const basicSection = document.querySelector('#group-container-basic, [data-group="basic"]');
        const basicButton = document.querySelector('[data-target="#group-container-basic"], [data-bs-target="#group-container-basic"], button[aria-controls="group-container-basic"]');
        
        if (basicSection && !basicSection.classList.contains('show')) {
          basicSection.classList.add('show', 'in');
          basicSection.style.display = 'block';
          if (basicButton) {
            basicButton.setAttribute('aria-expanded', 'true');
            basicButton.classList.add('active');
          }
        }
        
        const groupButtons = document.querySelectorAll('.builder-sidebar button[data-toggle="collapse"], .builder-sidebar .group-button, .formbuilder-group-header, button[aria-controls*="group-container"]');
        groupButtons.forEach(button => {
          // Remove any existing click handlers
          const newButton = button.cloneNode(true);
          button.parentNode.replaceChild(newButton, button);
          
          newButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // Get the target element
            const targetId = this.getAttribute('data-target') || this.getAttribute('data-bs-target') || this.getAttribute('aria-controls');
            const targetEl = targetId ? document.querySelector(targetId || `#${targetId}`) : this.nextElementSibling;
            
            if (targetEl) {
              const isCurrentlyOpen = targetEl.classList.contains('show') || targetEl.classList.contains('in');
              
              // If this is the only open section, don't close it
              if (isCurrentlyOpen) {
                const openSections = document.querySelectorAll('.builder-sidebar .collapse.show, .builder-sidebar .collapse.in');
                if (openSections.length <= 1) {
                  return; // Don't close if it's the only open section
                }
              }
              
              // Close all other sections
              document.querySelectorAll('.builder-sidebar .collapse, .builder-sidebar .panel-collapse, #group-container-basic, #group-container-advanced, #group-container-layout, #group-container-data').forEach(section => {
                if (section !== targetEl) {
                  section.classList.remove('show', 'in');
                  section.style.display = 'none';
                }
              });
              
              // Update all button states
              const allButtons = document.querySelectorAll('.builder-sidebar button[data-toggle="collapse"], .builder-sidebar .group-button, .formbuilder-group-header, button[aria-controls*="group-container"]');
              allButtons.forEach(btn => {
                if (btn !== newButton) {
                  btn.setAttribute('aria-expanded', 'false');
                  btn.classList.remove('active');
                }
              });
              
              // Open the clicked section (if not already open)
              if (!isCurrentlyOpen) {
                targetEl.classList.add('show', 'in');
                targetEl.style.display = 'block';
                this.setAttribute('aria-expanded', 'true');
                this.classList.add('active');
              }
            }
          });
        });
        
        // Fix duplicate icons issue - remove FA icons, keep only Bootstrap Icons
        const fixIcons = () => {
          document.querySelectorAll('.component-settings-button').forEach(btn => {
            const faIcon = btn.querySelector('i.fa');
            if (faIcon) {
              faIcon.style.display = 'none';
            }
          });
        };
        fixIcons();
        // Re-run after any DOM changes
        const observer = new MutationObserver(fixIcons);
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Fix modal dimming issue - inject styles to ensure proper z-index
        const modalFixStyle = document.createElement('style');
        modalFixStyle.innerHTML = `
          .formio-dialog-overlay {
            z-index: 9998 !important;
            opacity: 0.5 !important;
          }
          .formio-dialog {
            z-index: 10000 !important;
          }
          .formio-dialog-content {
            z-index: 10001 !important;
            opacity: 1 !important;
            filter: none !important;
            background: white !important;
          }
          .formio-dialog.component-settings {
            opacity: 1 !important;
            filter: none !important;
          }
        `;
        document.head.appendChild(modalFixStyle);
        
        // Also handle Bootstrap collapse
        const accordionButtons = document.querySelectorAll('[data-bs-toggle="collapse"], [data-toggle="collapse"]');
        accordionButtons.forEach(button => {
          if (!button.hasAttribute('data-accordion-fixed')) {
            button.setAttribute('data-accordion-fixed', 'true');
            button.onclick = function(e) {
              e.preventDefault();
              e.stopPropagation();
              
              const targetSelector = this.getAttribute('data-bs-target') || this.getAttribute('data-target');
              const target = document.querySelector(targetSelector);
              
              if (target) {
                const isOpen = target.classList.contains('show') || target.classList.contains('in');
                
                // If trying to close the only open section, don't allow it
                if (isOpen) {
                  const openSections = document.querySelectorAll('.builder-sidebar .collapse.show, .builder-sidebar .collapse.in');
                  if (openSections.length <= 1) {
                    return;
                  }
                }
                
                // Close all other accordion sections
                document.querySelectorAll('.builder-sidebar .collapse').forEach(section => {
                  if (section !== target) {
                    section.classList.remove('show', 'in');
                    section.style.display = 'none';
                  }
                });
                
                // Reset all button states
                accordionButtons.forEach(btn => {
                  if (btn !== this) {
                    btn.setAttribute('aria-expanded', 'false');
                  }
                });
                
                // Open the clicked section if it was closed
                if (!isOpen) {
                  target.classList.add('show', 'in');
                  target.style.display = 'block';
                  this.setAttribute('aria-expanded', 'true');
                }
              }
            };
          }
        });
      }, 500);
      
      // FIX: Patch the builder instance to prevent slice errors
      if (builder.instance) {
        // Override any methods that might cause slice errors
        const originalSetForm = builder.instance.setForm;
        if (originalSetForm) {
          builder.instance.setForm = function(form) {
            try {
              // Ensure form has required properties
              if (!form) form = {};
              if (!form.components) form.components = [];
              if (!form.display) form.display = 'form';
              return originalSetForm.call(this, form);
            } catch (e) {
              console.warn('Caught setForm error:', e);
              return Promise.resolve();
            }
          };
        }
      }
      
      // FIX: Patch component groups to prevent slice errors
      if (builder.groups) {
        Object.keys(builder.groups).forEach(groupKey => {
          const group = builder.groups[groupKey];
          if (group && group.components) {
            // Ensure each component has required properties
            Object.keys(group.components).forEach(compKey => {
              const comp = group.components[compKey];
              if (comp && !comp.key) {
                comp.key = compKey;
              }
              if (comp && !comp.type) {
                comp.type = compKey;
              }
            });
          }
        });
      }

      // Handle form changes
      builder.on('change', (schema) => {
        handleFormChange(schema);
      });

      // Handle save component
      builder.on('saveComponent', () => {
        console.log('Component saved');
      });

      // Handle delete component
      builder.on('deleteComponent', () => {
        console.log('Component deleted');
      });
    }).catch((err) => {
      console.error('Error creating builder:', err);
      toast.error('Failed to initialize form builder');
    });

    // Cleanup function
    return () => {
      if (builderInstanceRef.current) {
        try {
          builderInstanceRef.current.destroy();
        } catch (e) {
          console.error('Error destroying builder:', e);
        }
        builderInstanceRef.current = null;
      }
    };
  }, [displayMode, showPreview]); // Only re-run when display mode or preview mode changes

  return (
    <div className="form-builder-container">
      <ToastContainer position="top-right" autoClose={3000} />
      
      {/* Header */}
      <div className="form-builder-header">
        <div className="header-left">
          <button 
            onClick={() => navigate('/forms')}
            className="btn btn-outline-secondary me-2"
          >
            <i className="bi bi-arrow-left"></i> Back
          </button>
          <input
            type="text"
            className="form-control form-title-input"
            placeholder="Form Title"
            value={form.title || ''}
            onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
          />
        </div>
        
        <div className="header-right">
          {/* Display Type Selector */}
          <div className="me-3">
            <label className="me-2">Display as:</label>
            <select 
              className="form-select form-select-sm d-inline-block w-auto"
              value={displayMode}
              onChange={handleDisplayChange}
            >
              <option value="form">Form</option>
              <option value="wizard">Wizard</option>
            </select>
          </div>
          
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="btn btn-outline-primary me-2"
          >
            <i className={`bi bi-${showPreview ? 'pencil' : 'eye'}`}></i>
            {showPreview ? ' Edit' : ' Preview'}
          </button>
          
          <button
            onClick={saveForm}
            disabled={saving}
            className="btn btn-success me-2"
          >
            <i className="bi bi-save"></i>
            {saving ? ' Saving...' : ' Save'}
          </button>
          
          {formId && (
            <button
              onClick={togglePublish}
              className={`btn ${formUrl ? 'btn-warning' : 'btn-info'}`}
            >
              <i className={`bi bi-${formUrl ? 'eye-slash' : 'globe'}`}></i>
              {formUrl ? ' Unpublish' : ' Publish'}
            </button>
          )}
        </div>
      </div>

      {/* Public URL Display */}
      {formUrl && (
        <div className="alert alert-info mt-3 d-flex align-items-center">
          <i className="bi bi-link-45deg me-2"></i>
          <span className="me-2">Public URL:</span>
          <code className="flex-grow-1">{formUrl}</code>
          <button 
            onClick={copyToClipboard}
            className="btn btn-sm btn-outline-primary ms-2"
          >
            <i className="bi bi-clipboard"></i> Copy
          </button>
        </div>
      )}

      {/* Form Builder / Preview */}
      <div className="form-builder-body">
        {loading ? (
          <div className="text-center p-5">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        ) : showPreview ? (
          <div className="form-preview-container">
            <h3 className="mb-4">Form Preview</h3>
            <div className="preview-wrapper">
              <Form
                form={form}
                onSubmit={handleSubmitTest}
                options={{
                  readOnly: false,
                  noAlerts: false
                }}
              />
            </div>
            {Object.keys(testData).length > 0 && (
              <div className="mt-4 p-3 bg-light rounded">
                <h5>Last Test Submission:</h5>
                <pre className="mb-0">{JSON.stringify(testData, null, 2)}</pre>
              </div>
            )}
          </div>
        ) : (
          <div className="formio-builder-wrapper">
            <div ref={builderContainerRef} id="builder"></div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FormBuilder;